import { Injectable } from '@nestjs/common';
import { RuntimeFlowTraceLogger } from '../../../../common/trace/runtime-flow-trace.logger';
import type { AgentRuntimeEvent } from '../../contracts/agent-runtime-event.types';
import type { AgentToolExecutionRecord, AgentToolResult } from '../../contracts/agent-tool.types';
import type { AgentRuntimeToolCall, AgentRuntimeTurnRequest } from '../../contracts/agent-turn.types';
import { AgentToolRuntimeService } from '../../tools/agent-tool-runtime.service';
import { hash, stableStringify } from '../util/runtime.util';
import { ToolArgumentRepairService } from './tool-argument-repair.service';

@Injectable()
export class ToolExecutionCoordinatorService {
  constructor(
    private readonly tools: AgentToolRuntimeService,
    private readonly argumentRepair: ToolArgumentRepairService,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async authorizedSurface(request: AgentRuntimeTurnRequest) {
    if (!request.tools.length) return [];
    const names = request.tools.map((tool) => tool.metadata?.canonicalName ?? tool.name);
    const current = await this.tools.listDefinitionsForUser({
      userId: request.userId, agentId: request.agentId, toolEnabled: true,
      workspaceRoot: request.workspace.rootPath, enabledToolNames: names, runtimeToolNames: names,
    });
    const ceiling = new Set(request.tools.map((tool) => tool.name));
    return current.filter((tool) => ceiling.has(tool.name));
  }

  select(
    request: AgentRuntimeTurnRequest,
    calls: AgentRuntimeToolCall[],
  ): AgentRuntimeToolCall[] {
    const exclusive = calls.find((call) =>
      this.tools.policy(
        call.name,
        request.workspace.rootPath,
      ).batchBehavior === 'exclusive',
    );

    return exclusive ? [exclusive] : calls;
  }

  async execute(input: {
    request: AgentRuntimeTurnRequest;
    calls: AgentRuntimeToolCall[];
    iteration: number;
    signal?: AbortSignal;
    emit(event: AgentRuntimeEvent): Promise<void> | void;
  }): Promise<AgentToolExecutionRecord[]> {
    const startedAt = Date.now();
    const normalized = input.calls.map((call) => this.normalize(call));
    const resolved = await Promise.all(
      normalized.map((call) => this.resolveToolName(input.request, call)),
    );
    const selected = this.select(input.request, resolved);
    const canParallelize = selected.length > 1 && selected.every((call) => {
      const policy = this.tools.policy(call.name, input.request.workspace.rootPath);
      return policy.parallelism === 'parallel_safe' && !policy.requiresApproval;
    });

    this.trace.event('agent_tools.batch_start', {
      trace: input.request.traceId,
      conversationId: input.request.conversationId,
      assistantMessageId: input.request.assistantMessageId,
      callCount: selected.length,
      skippedCount: normalized.length - selected.length,
      mode: canParallelize ? 'parallel' : 'serial',
      tools: selected.map((call) => call.name).join(','),
    });

    try {
      const output = canParallelize
        ? await Promise.all(
            selected.map((call) => this.executeOne({ ...input, call })),
          )
        : await this.executeSerial({ ...input, calls: selected });

      this.trace.event('agent_tools.batch_done', {
        trace: input.request.traceId,
        conversationId: input.request.conversationId,
        assistantMessageId: input.request.assistantMessageId,
        callCount: output.length,
        failedCount: output.filter((record) => record.result.status === 'failed').length,
        durationMs: Date.now() - startedAt,
      });

      return output;
    } catch (error) {
      this.trace.error('agent_tools.batch_failed', {
        trace: input.request.traceId,
        conversationId: input.request.conversationId,
        assistantMessageId: input.request.assistantMessageId,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async executeSerial(input: {
    request: AgentRuntimeTurnRequest;
    calls: AgentRuntimeToolCall[];
    iteration: number;
    signal?: AbortSignal;
    emit(event: AgentRuntimeEvent): Promise<void> | void;
  }): Promise<AgentToolExecutionRecord[]> {
    const output: AgentToolExecutionRecord[] = [];
    for (const call of input.calls) {
      if (input.signal?.aborted) break;
      output.push(await this.executeOne({ ...input, call }));
    }
    return output;
  }

  private normalize(call: AgentRuntimeToolCall): AgentRuntimeToolCall {
    const parsed = this.argumentRepair.parse(call.rawArguments, call.arguments);
    return { ...call, arguments: parsed.arguments };
  }

  private async resolveToolName(
    request: AgentRuntimeTurnRequest,
    call: AgentRuntimeToolCall,
  ): Promise<AgentRuntimeToolCall> {
    if (!call.name) return call;

    const resolution = await this.tools.resolveAllowedToolName({
      requestedName: call.name,
      allowedDefinitions: request.tools,
      userId: request.userId,
      agentId: request.agentId,
      workspaceRoot: request.workspace.rootPath,
    });

    if (!resolution) return call;

    if (resolution.runtimeName !== call.name) {
      this.trace.event('agent_tool.name_resolved', {
        trace: request.traceId,
        conversationId: request.conversationId,
        assistantMessageId: request.assistantMessageId,
        toolCallId: call.id,
        requestedTool: call.name,
        runtimeTool: resolution.runtimeName,
        canonicalTool: resolution.canonicalName,
        matchedBy: resolution.matchedBy,
      });
    }

    return {
      ...call,
      name: resolution.runtimeName,
    };
  }

  private async executeOne(input: {
    request: AgentRuntimeTurnRequest;
    call: AgentRuntimeToolCall;
    iteration: number;
    signal?: AbortSignal;
    emit(event: AgentRuntimeEvent): Promise<void> | void;
  }): Promise<AgentToolExecutionRecord> {
    const startedAt = Date.now();

    this.trace.event('agent_tool.call_start', {
      trace: input.request.traceId,
      conversationId: input.request.conversationId,
      assistantMessageId: input.request.assistantMessageId,
      toolCallId: input.call.id,
      tool: input.call.name,
      timeoutMs: input.request.timeouts.tool * 1000,
    });

    const policy = this.tools.policy(
      input.call.name,
      input.request.workspace.rootPath,
    );

    await input.emit(this.event(input.request, 'tool.requested', {
      call: input.call,
      presentation: policy.presentation,
    }));
    await input.emit(this.event(input.request, 'tool.started', {
      call: input.call,
      presentation: policy.presentation,
    }));

    let result: AgentToolResult;
    if (!input.call.name) {
      result = {
        status: 'failed',
        errorCode: 'TOOL_NAME_MISSING',
        message: 'Model emitted a tool call without a name',
        retryable: false,
      };
    } else if (!this.isAllowed(input.request, input.call.name)) {
      result = {
        status: 'failed',
        errorCode: 'TOOL_NOT_ALLOWED',
        message: `Tool is not enabled for this runtime slice: ${input.call.name}`,
        retryable: false,
      };
    } else {
      result = await this.tools.invoke({
        traceId: input.request.traceId,
        userId: input.request.userId,
        agentId: input.request.agentId,
        conversationId: input.request.conversationId,
        userMessageId: input.request.userMessageId,
        assistantMessageId: input.request.assistantMessageId,
        branchObjectIds: input.request.branchObjectIds,
        toolCallId: input.call.id,
        iteration: input.iteration,
        stepId: `agent_step_${hash(
          `${input.request.traceId}:${input.iteration}`,
          18,
        )}`,
        modelId: input.request.agent.model,
        modelProvider: input.request.agent.provider,
        name: input.call.name,
        arguments: input.call.arguments,
        permissionMode: input.request.permissionMode,
        localization: input.request.localization,
        workspace: input.request.workspace,
        abortSignal: input.signal,
        timeoutMs: input.request.timeouts.tool * 1000,
      });
    }

    const finishedAt = Date.now();
    await input.emit(this.event(
      input.request,
      result.status === 'failed' ? 'tool.failed' : 'tool.completed',
      { call: input.call, result, presentation: policy.presentation },
    ));

    this.trace.event('agent_tool.call_done', {
      trace: input.request.traceId,
      conversationId: input.request.conversationId,
      assistantMessageId: input.request.assistantMessageId,
      toolCallId: input.call.id,
      tool: input.call.name,
      status: result.status,
      errorCode: result.status === 'failed' ? result.errorCode : null,
      retryable: result.status === 'failed' ? result.retryable : null,
      durationMs: finishedAt - startedAt,
    });

    return {
      call: input.call,
      canonicalName: policy.originalName ?? input.call.name,
      sideEffectClass: policy.sideEffectClass,
      result,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      finishTurn:
        policy.turnBehavior === 'finish_on_success'
        && result.status === 'completed',
      presentation: policy.presentation,
      fingerprint: hash([
        input.call.name,
        stableStringify(input.call.arguments),
        result.status,
        result.status === 'completed'
          ? result.observation
          : result.status === 'failed'
            ? `${result.errorCode}:${result.message}`
            : result.approvalId,
      ].join(':')),
    };
  }


  private isAllowed(
    request: AgentRuntimeTurnRequest,
    runtimeToolName: string,
  ): boolean {
    return request.tools.some((tool) => tool.name === runtimeToolName);
  }

  private event(
    request: AgentRuntimeTurnRequest,
    type: 'tool.requested' | 'tool.started' | 'tool.completed' | 'tool.failed',
    data: { call: AgentRuntimeToolCall; result?: AgentToolResult; presentation?: 'activity' | 'workflow' | 'hidden' },
  ): AgentRuntimeEvent {
    const common = {
      traceId: request.traceId,
      conversationId: request.conversationId,
      userMessageId: request.userMessageId,
      assistantMessageId: request.assistantMessageId,
      timestamp: Date.now(),
      call: data.call,
      presentation: data.presentation,
    };

    switch (type) {
      case 'tool.requested':
        return { ...common, type: 'tool.requested' };
      case 'tool.started':
        return { ...common, type: 'tool.started' };
      case 'tool.completed':
        return { ...common, type: 'tool.completed', result: data.result! };
      case 'tool.failed':
        return { ...common, type: 'tool.failed', result: data.result! };
    }
  }
}
