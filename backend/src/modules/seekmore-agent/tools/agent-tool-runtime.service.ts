import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { ToolsRegistry } from '../../../tools/toolsregistry';
import type { Tool } from '../../../tools/toolstypes';
import { RuntimeAccessPolicyService } from '../../approval/runtime-access-policy.service';
import {
  MCP_CALL_NAME,
  MCP_TOOLS_SEARCH_NAME,
  McpRuntimeToolProvider,
} from '../../mcp/runtime/mcp-runtime-tool.provider';
import { RuntimeActionRiskService } from '../../approval/runtime-action-risk.service';
import { RuntimeApprovalService } from '../../approval/runtime-approval.service';
import { RuntimeWorkspaceResolver } from '../../workspace/runtime-workspace-resolver.service';
import type { AgentToolInvocationRequest, AgentToolResult } from '../contracts/agent-tool.types';
import type { AgentRuntimeToolDefinition } from '../contracts/agent-turn.types';
import { AgentCheckpointRepository } from '../persistence/agent-checkpoint.repository';
import { AgentTurnRepository } from '../persistence/agent-turn.repository';
import { ToolResultAdapterService } from './tool-result-adapter.service';
import { ToolSchemaAdapterService } from './tool-schema-adapter.service';

@Injectable()
export class AgentToolRuntimeService {
  constructor(
    private readonly registry: ToolsRegistry,
    private readonly mcpTools: McpRuntimeToolProvider,
    private readonly schemas: ToolSchemaAdapterService,
    private readonly results: ToolResultAdapterService,
    private readonly approvals: RuntimeApprovalService,
    private readonly accessPolicy: RuntimeAccessPolicyService,
    private readonly actionRisk: RuntimeActionRiskService,
    private readonly workspaceResolver: RuntimeWorkspaceResolver,
    private readonly turns: AgentTurnRepository,
    private readonly checkpoints: AgentCheckpointRepository,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  listDefinitions(input: {
    toolEnabled: boolean;
    workspaceRoot?: string | null;
    enabledToolNames?: string[];
    runtimeToolNames?: string[];
    disabledToolNames?: string[];
    enabledCapabilityKinds?: string[];
  }): AgentRuntimeToolDefinition[] {
    return this.availableTools(input.workspaceRoot, {
      includeRuntimeOnly: true,
      includeNormalTools: input.toolEnabled,
      enabledToolNames: input.enabledToolNames,
      runtimeToolNames: input.runtimeToolNames,
      disabledToolNames: input.disabledToolNames,
      enabledCapabilityKinds: input.enabledCapabilityKinds,
    }).map(
      (tool) => this.schemas.toRuntime(tool),
    );
  }

  async listDefinitionsForUser(input: {
    userId: string;
    agentId: string;
    toolEnabled: boolean;
    workspaceRoot?: string | null;
    enabledToolNames?: string[];
    runtimeToolNames?: string[];
    disabledToolNames?: string[];
    enabledCapabilityKinds?: string[];
  }): Promise<AgentRuntimeToolDefinition[]> {
    const normalTools = input.toolEnabled
      ? await this.registry.listForUser(
          input.userId,
          { enabledOnly: true },
        )
      : [];
    const runtimeTools = this.registry.list({
      enabledOnly: true,
      includeRuntimeOnly: true,
    }).filter((tool) => tool.runtimeOnly === true);
    const mcpDiscoveryTools = input.toolEnabled
      ? await this.mcpTools.listDiscoveryTools({
          userId: input.userId,
          agentId: input.agentId,
        })
      : [];
    const requestedMcpTools = input.toolEnabled
      ? await this.mcpTools.listRequestedTools({
          userId: input.userId,
          agentId: input.agentId,
          runtimeToolNames: input.runtimeToolNames ?? [],
        })
      : [];

    const selectedTools = this.filterAvailableTools(
      [
        ...normalTools,
        ...runtimeTools,
        ...mcpDiscoveryTools,
        ...requestedMcpTools,
      ],
      input.workspaceRoot,
      {
        includeNormalTools: input.toolEnabled,
        enabledToolNames: input.enabledToolNames,
        runtimeToolNames: input.runtimeToolNames,
        disabledToolNames: input.disabledToolNames,
        enabledCapabilityKinds:
          input.enabledCapabilityKinds,
      },
    );
    const definitions = selectedTools.map(
      (tool) => this.schemas.toRuntime(tool),
    );

    this.trace.event('agent_tools.definition_pool_built', {
      userId: input.userId,
      agentId: input.agentId,
      total: definitions.length,
      system: selectedTools.filter((tool) => tool.providerKind !== 'mcp').length,
      mcpMeta: selectedTools.filter((tool) =>
        tool.name === MCP_TOOLS_SEARCH_NAME || tool.name === MCP_CALL_NAME,
      ).length,
      mcpConcrete: selectedTools.filter((tool) =>
        tool.providerKind === 'mcp'
        && tool.name !== MCP_TOOLS_SEARCH_NAME
        && tool.name !== MCP_CALL_NAME,
      ).length,
    });

    return definitions;
  }

  async resolveAllowedToolName(input: {
    requestedName: string;
    allowedDefinitions: AgentRuntimeToolDefinition[];
    userId: string;
    agentId: string;
    workspaceRoot?: string | null;
  }): Promise<{
    runtimeName: string;
    canonicalName: string;
    matchedBy: 'canonical' | 'runtime' | 'legacy';
  } | null> {
    const requestedName = String(input.requestedName ?? '').trim();
    if (!requestedName) return null;

    const allowedRuntimeNames = new Set(
      input.allowedDefinitions
        .map((definition) => String(definition.name ?? '').trim())
        .filter(Boolean),
    );

                                                                          
                                                                              
                                                                
    if (allowedRuntimeNames.has(requestedName)) {
      return {
        runtimeName: requestedName,
        canonicalName: requestedName,
        matchedBy: 'runtime',
      };
    }

    const normalTools = await this.registry.listForUser(
      input.userId,
      { enabledOnly: true },
    );
    const runtimeTools = this.registry.list({
      enabledOnly: true,
      includeRuntimeOnly: true,
    }).filter((tool) => tool.runtimeOnly === true);

    const discoveryTools = await this.mcpTools.listDiscoveryTools({
      userId: input.userId,
      agentId: input.agentId,
    });
    const localCandidates = this.filterAvailableTools(
      [...normalTools, ...runtimeTools, ...discoveryTools],
      input.workspaceRoot,
      {
        includeNormalTools: true,
        runtimeToolNames: [...allowedRuntimeNames],
      },
    );

    const localResolution = this.schemas.resolveRuntimeNameDetailed(
      requestedName,
      localCandidates,
    );
    if (
      localResolution
      && allowedRuntimeNames.has(localResolution.runtimeName)
    ) {
      return {
        runtimeName: localResolution.runtimeName,
        canonicalName: localResolution.canonicalName,
        matchedBy: localResolution.matchedBy,
      };
    }

                                                                             
                                           
    const dynamicTools = await this.mcpTools.listTools({
      userId: input.userId,
      agentId: input.agentId,
    });
    const dynamicCandidates = this.filterAvailableTools(
      dynamicTools,
      input.workspaceRoot,
      {
        includeNormalTools: true,
        runtimeToolNames: [...allowedRuntimeNames],
      },
    );
    const dynamicResolution = this.schemas.resolveRuntimeNameDetailed(
      requestedName,
      dynamicCandidates,
    );
    if (
      !dynamicResolution
      || !allowedRuntimeNames.has(dynamicResolution.runtimeName)
    ) {
      return null;
    }

    return {
      runtimeName: dynamicResolution.runtimeName,
      canonicalName: dynamicResolution.canonicalName,
      matchedBy: dynamicResolution.matchedBy,
    };
  }

  policy(name: string, workspaceRoot?: string | null): {
    parallelism: 'parallel_safe' | 'resource_serial' | 'interactive_serial';
    requiresApproval: boolean;
    sideEffectClass: string;
    batchBehavior: 'coexist' | 'exclusive';
    turnBehavior: 'continue' | 'finish_on_success';
    presentation: 'activity' | 'workflow' | 'hidden';
    originalName: string | null;
  } {
    if (this.matchesRuntimeToolName(name, MCP_TOOLS_SEARCH_NAME)) {
      return {
        parallelism: 'parallel_safe',
        requiresApproval: false,
        sideEffectClass: 'read_only',
        batchBehavior: 'coexist',
        turnBehavior: 'continue',
        presentation: 'hidden',
        originalName: MCP_TOOLS_SEARCH_NAME,
      };
    }
    if (this.matchesRuntimeToolName(name, MCP_CALL_NAME)) {
      return {
        parallelism: 'resource_serial',
        requiresApproval: false,
        sideEffectClass: 'external_effect',
        batchBehavior: 'coexist',
        turnBehavior: 'continue',
        presentation: 'activity',
        originalName: MCP_CALL_NAME,
      };
    }

    const tool = this.schemas.resolveRuntimeName(
      name,
      this.availableTools(workspaceRoot, {
        includeRuntimeOnly: true,
        runtimeToolNames: [name],
      }),
    );
    return {
      parallelism: tool?.parallelism ?? 'resource_serial',
      requiresApproval: tool?.requiresApproval === true,
      sideEffectClass: tool?.sideEffectClass ?? 'none',
      batchBehavior: tool?.batchBehavior ?? 'coexist',
      turnBehavior: tool?.turnBehavior ?? 'continue',
      presentation: tool?.presentation ?? (tool?.runtimeOnly ? 'hidden' : 'activity'),
      originalName: tool?.name ?? null,
    };
  }

  async invoke(
    input: AgentToolInvocationRequest,
  ): Promise<AgentToolResult> {
    const startedAt = Date.now();
    let stage = 'resolve_tool';

    this.trace.event('agent_tool_runtime.invoke_start', {
      trace: input.traceId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      toolCallId: input.toolCallId,
      requestedTool: input.name,
      permissionMode: input.permissionMode,
      workspaceId: input.workspace.workspaceId,
      workspaceResolved: Boolean(input.workspace.rootPath),
      timeoutMs: input.timeoutMs ?? null,
    });

    const heartbeat = setInterval(() => {
      this.trace.warn('agent_tool_runtime.invoke_heartbeat', {
        trace: input.traceId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        toolCallId: input.toolCallId,
        requestedTool: input.name,
        stage,
        elapsedMs: Date.now() - startedAt,
      });
    }, this.heartbeatMs());
    heartbeat.unref?.();

    try {
      let tool = this.schemas.resolveRuntimeName(
        input.name,
        this.availableTools(input.workspace.rootPath, {
          includeRuntimeOnly: true,
          runtimeToolNames: [input.name],
        }),
      );
      if (!tool) {
        const discoveryTools = await this.mcpTools.listDiscoveryTools({
          userId: input.userId,
          agentId: input.agentId,
        });
        tool = this.schemas.resolveRuntimeName(input.name, discoveryTools);
      }
      if (!tool) {
        const dynamicTools = await this.mcpTools.listTools({
          userId: input.userId,
          agentId: input.agentId,
        });
        tool = this.schemas.resolveRuntimeName(input.name, dynamicTools);
      }

      if (!tool) {
        this.trace.warn('agent_tool_runtime.tool_not_found', {
          trace: input.traceId,
          toolCallId: input.toolCallId,
          requestedTool: input.name,
        });
        return {
          status: 'failed',
          errorCode: 'TOOL_NOT_FOUND',
          message: `Tool not found: ${input.name}`,
          retryable: false,
        };
      }

      if (!tool.runtimeOnly && !(await this.registry.isEnabledForUser(
        input.userId,
        tool.name,
      ))) {
        this.trace.warn('agent_tool_runtime.tool_disabled_by_user', {
          trace: input.traceId,
          toolCallId: input.toolCallId,
          requestedTool: input.name,
          resolvedTool: tool.name,
          userId: input.userId,
        });

        return {
          status: 'failed',
          errorCode: 'TOOL_DISABLED_BY_USER',
          message: `Tool disabled by user: ${tool.name}`,
          retryable: false,
        };
      }

      this.trace.event('agent_tool_runtime.tool_resolved', {
        trace: input.traceId,
        toolCallId: input.toolCallId,
        requestedTool: input.name,
        resolvedTool: tool.name,
        requiresApproval: this.requiresApproval(tool, input.arguments),
        sideEffectClass: tool.sideEffectClass,
        parallelism: tool.parallelism,
      });

      stage = 'invoke_resolved';
      const result = await this.invokeResolved(tool, input, (nextStage) => {
        stage = nextStage;
      });

      this.trace.event('agent_tool_runtime.invoke_done', {
        trace: input.traceId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        toolCallId: input.toolCallId,
        tool: tool.name,
        status: result.status,
        errorCode: result.status === 'failed' ? result.errorCode : null,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      const result = this.failureFromError(error, input.abortSignal);
      this.trace.error('agent_tool_runtime.invoke_failed', {
        trace: input.traceId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        toolCallId: input.toolCallId,
        requestedTool: input.name,
        stage,
        elapsedMs: Date.now() - startedAt,
        errorCode: result.errorCode,
        error: result.message,
      });
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async invokeResolved(
    tool: Tool,
    input: AgentToolInvocationRequest,
    setStage: (stage: string) => void,
  ): Promise<AgentToolResult> {
    if (input.abortSignal?.aborted) {
      return {
        status: 'failed',
        errorCode: 'TOOL_CANCELLED',
        message: 'Tool execution was cancelled',
        retryable: false,
      };
    }

    setStage('turn_lookup');
    const turn = await this.turns.findByTrace(input.traceId);
    if (!turn) {
      return {
        status: 'failed',
        errorCode: 'AGENT_TURN_NOT_FOUND',
        message: 'Agent turn not found',
        retryable: false,
      };
    }
    const runtimeToolAuthorized = tool.runtimeOnly
      ? this.turnExposesTool(turn.requestJson, tool)
      : false;
    if (tool.runtimeOnly && !runtimeToolAuthorized) {
      return {
        status: 'failed',
        errorCode: 'RUNTIME_TOOL_NOT_AVAILABLE_FOR_TURN',
        message: `Runtime-only tool is not available for this turn: ${tool.name}`,
        retryable: false,
      };
    }

    setStage('access_policy_resolve');
    let effectiveAccess = await this.accessPolicy.resolveForInvocation({
      traceId: input.traceId,
      userId: input.userId,
      conversationId: input.conversationId,
      requestedPermissionMode: input.permissionMode,
      requestedWorkspaceId: input.workspace.workspaceId ?? null,
    });
    const workspaceContext = effectiveAccess.workspaceId
      ? await this.workspaceResolver.resolve({
          traceId: input.traceId,
          userId: input.userId,
          agentId: input.agentId,
          conversationId: input.conversationId,
          workspaceId: effectiveAccess.workspaceId,
        })
      : null;
    const effectiveWorkspace = {
      workspaceId: effectiveAccess.workspaceId,
      rootPath: workspaceContext?.rootPath ?? null,
      readAllowed: Boolean(workspaceContext),
      writeAllowed: workspaceContext?.writable === true,
    };

    const workspaceFailure = this.checkWorkspace(tool, {
      ...input,
      workspace: effectiveWorkspace,
    });
    if (workspaceFailure) {
      this.trace.warn('agent_tool_runtime.workspace_rejected', {
        trace: input.traceId,
        toolCallId: input.toolCallId,
        tool: tool.name,
        workspaceId: effectiveAccess.workspaceId,
        errorCode: workspaceFailure.errorCode,
      });
      return workspaceFailure;
    }

    const assessment = await this.actionRisk.assess({
      tool,
      arguments: input.arguments,
      workspaceId: effectiveAccess.workspaceId,
    });
    const accessDecision = this.actionRisk.decide({
      permissionMode: effectiveAccess.permissionMode,
      assessment,
    });
    if (accessDecision === 'BLOCK') {
      return {
        status: 'failed',
        errorCode: 'ACTION_FORBIDDEN',
        message: `Tool action is forbidden by runtime policy: ${tool.name}`,
        retryable: false,
        metadata: {
          riskLevel: assessment.riskLevel,
          reasonCodes: assessment.reasonCodes,
        },
      };
    }

    let approvalGranted = accessDecision === 'ALLOW';
    let approvalId: string | null = null;

    if (accessDecision === 'REQUIRE_APPROVAL') {
      setStage('approval_request');
      this.trace.event('agent_tool_runtime.approval_request_start', {
        trace: input.traceId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        toolCallId: input.toolCallId,
        tool: tool.name,
        scopeType: effectiveAccess.scopeType,
        scopeId: effectiveAccess.scopeId,
        riskLevel: assessment.riskLevel,
      });

      const approval = await this.approvals.request({
        turnId: turn.id,
        traceId: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        toolCallId: input.toolCallId,
        toolName: tool.name,
        scopeType: effectiveAccess.scopeType,
        scopeId: effectiveAccess.scopeId,
        workflowId: effectiveAccess.workflowId,
        phaseId: effectiveAccess.phaseId,
        stepId: input.stepId,
        iteration: input.iteration,
        riskLevel: assessment.riskLevel,
        descriptorHash: assessment.descriptorHash,
        policyVersionAtRequest: effectiveAccess.policyVersion,
        permissionMode: effectiveAccess.permissionMode,
        actionPreview: {
          tool: tool.name,
          arguments: this.redact(tool, input.arguments),
          workspace: effectiveWorkspace,
          riskLevel: assessment.riskLevel,
          reasonCodes: assessment.reasonCodes,
        },
      });

      approvalId = approval.approvalId;
      await this.checkpoints.create({
        turnId: turn.id,
        state: {
          phase: 'waiting_approval',
          tool: tool.name,
          arguments: input.arguments,
          descriptorHash: assessment.descriptorHash,
          taskRunId: effectiveAccess.scopeId,
          iterationRuntime: 'typescript',
        },
        pendingToolCallId: input.toolCallId,
        pendingApprovalId: approval.approvalId,
      });

      setStage('approval_wait');
      this.trace.event('agent_tool_runtime.approval_wait_start', {
        trace: input.traceId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        toolCallId: input.toolCallId,
        tool: tool.name,
        approvalId,
        timeoutMs: Math.max(1_000, input.timeoutMs ?? 10 * 60_000),
      });

      try {
        const decision = await this.approvals.waitForDecision(
          approval.approvalId,
          Math.max(1_000, input.timeoutMs ?? 10 * 60_000),
          input.abortSignal,
        );

        this.trace.event('agent_tool_runtime.approval_wait_done', {
          trace: input.traceId,
          toolCallId: input.toolCallId,
          tool: tool.name,
          approvalId,
          decision,
        });

        if (decision === 'rejected') {
          return {
            status: 'failed',
            errorCode: 'APPROVAL_REJECTED',
            message: 'User rejected this tool call',
            retryable: false,
          };
        }

        const resolvedApproval = await this.approvals.load(
          approval.approvalId,
        );
        if (
          !resolvedApproval
          || resolvedApproval.descriptorHash !== assessment.descriptorHash
          || resolvedApproval.scopeId !== effectiveAccess.scopeId
          || resolvedApproval.toolCallId !== input.toolCallId
          || resolvedApproval.toolName !== tool.name
        ) {
          return {
            status: 'failed',
            errorCode: 'APPROVAL_DESCRIPTOR_MISMATCH',
            message: 'Approved operation no longer matches the pending tool call',
            retryable: false,
          };
        }

        effectiveAccess = await this.accessPolicy.resolveForInvocation({
          traceId: input.traceId,
          userId: input.userId,
          conversationId: input.conversationId,
          requestedPermissionMode: input.permissionMode,
          requestedWorkspaceId: input.workspace.workspaceId ?? null,
        });
        if (effectiveAccess.workspaceId !== effectiveWorkspace.workspaceId) {
          return {
            status: 'failed',
            errorCode: 'APPROVAL_WORKSPACE_CHANGED',
            message: 'Workspace changed before the approved operation could start',
            retryable: false,
          };
        }
        approvalGranted = true;
      } catch (error) {
        const cancelled = input.abortSignal?.aborted
          || (
            error instanceof Error
            && error.message === 'APPROVAL_WAIT_CANCELLED'
          );
        return {
          status: 'failed',
          errorCode: cancelled
            ? 'APPROVAL_WAIT_CANCELLED'
            : 'APPROVAL_EXPIRED',
          message: error instanceof Error
            ? error.message
            : String(error),
          retryable: !cancelled,
        };
      }
    }

    setStage('registry_execute');
    this.trace.event('agent_tool_runtime.registry_execute_start', {
      trace: input.traceId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      toolCallId: input.toolCallId,
      tool: tool.name,
      timeoutMs: input.timeoutMs ?? null,
      approvalGranted,
    });

    const executeStartedAt = Date.now();
    const executionContext = {
        userId: input.userId,
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        traceId: input.traceId,
        requestId: input.toolCallId,
        idempotencyKey:
          `${input.traceId}:${input.toolCallId || randomUUID()}:${tool.name}`,
        abortSignal: input.abortSignal,
        localization: input.localization,
        metadata: {
          formatLocale: input.localization.formatLocale,
          timeZone: input.localization.timeZone,
          workspaceId: effectiveWorkspace.workspaceId ?? null,
          workspaceRoot: effectiveWorkspace.rootPath ?? null,
          approvalGranted,
          permissionMode: effectiveAccess.permissionMode,
          accessPolicyVersion: effectiveAccess.policyVersion,
          taskScopeType: effectiveAccess.scopeType,
          taskRunId: effectiveAccess.scopeId,
          riskLevel: assessment.riskLevel,
          approvalDescriptorHash: assessment.descriptorHash,
          agentId: input.agentId,
          turnId: turn.id,
          stepId: input.stepId,
          modelId: input.modelId ?? null,
          modelProvider: input.modelProvider ?? null,
          assistantMessageId: input.assistantMessageId,
          branchObjectIds: input.branchObjectIds ?? [],
          runtimeToolAuthorized,
          runtime: 'seekmore-agent-runtime-ts',
        },
      };
    const dispatchOptions = { timeoutMs: input.timeoutMs };
    const result = tool.providerKind === 'mcp'
      ? await this.registry.executeResolved(
          tool,
          input.arguments,
          executionContext,
          dispatchOptions,
        )
      : await this.registry.execute(
          tool.name,
          input.arguments,
          executionContext,
          dispatchOptions,
        );

    this.trace.event('agent_tool_runtime.registry_execute_done', {
      trace: input.traceId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      toolCallId: input.toolCallId,
      tool: tool.name,
      durationMs: Date.now() - executeStartedAt,
      resultOk: result.ok,
      resultStatus: result.status,
      errorCode: result.ok ? null : result.error?.code ?? null,
      errorMessage: result.ok ? null : result.error?.message ?? null,
    });

    setStage('result_adapt');
    const adapted = this.results.adapt(result, {
      captureCompletionText: tool.turnBehavior === 'finish_on_success',
    });
    if (approvalId) {
      await this.approvals
        .markResumed(approvalId)
        .catch(() => undefined);
    }
    return adapted;
  }

  private failureFromError(
    error: unknown,
    signal?: AbortSignal,
  ): Extract<AgentToolResult, { status: 'failed' }> {
    const value = error && typeof error === 'object'
      ? error as {
          code?: unknown;
          message?: unknown;
          details?: unknown;
        }
      : {};

    const errorCode = signal?.aborted
      ? 'TOOL_CANCELLED'
      : String(value.code ?? 'TOOL_EXECUTION_ERROR');

    const message = signal?.aborted
      ? 'Tool execution was cancelled'
      : String(
          value.message
          ?? error
          ?? 'Tool execution failed',
        );

    return {
      status: 'failed',
      errorCode,
      message,
      retryable: !signal?.aborted && [
        'TOOL_TIMEOUT',
        'TOOL_QUEUE_FULL',
        'TOOL_QUEUE_TIMEOUT',
        'IDEMPOTENCY_IN_PROGRESS',
        'TOOL_EXECUTION_ERROR',
      ].includes(errorCode),
      metadata: value.details === undefined
        ? undefined
        : { details: value.details },
    };
  }

  private availableTools(
    workspaceRoot?: string | null,
    filter: {
      includeRuntimeOnly?: boolean;
      includeNormalTools?: boolean;
      enabledToolNames?: string[];
      runtimeToolNames?: string[];
      disabledToolNames?: string[];
      enabledCapabilityKinds?: string[];
    } = {},
  ): Tool[] {
    return this.filterAvailableTools(
      this.registry.list({
        enabledOnly: true,
        includeRuntimeOnly: filter.includeRuntimeOnly === true,
      }),
      workspaceRoot,
      filter,
    );
  }

  private filterAvailableTools(
    tools: Tool[],
    workspaceRoot?: string | null,
    filter: {
      includeNormalTools?: boolean;
      enabledToolNames?: string[];
      runtimeToolNames?: string[];
      disabledToolNames?: string[];
      enabledCapabilityKinds?: string[];
    } = {},
  ): Tool[] {
    const enabledToolNames = new Set(
      (filter.enabledToolNames ?? [])
        .map((name) => String(name).trim())
        .filter(Boolean),
    );
    const runtimeToolNames = new Set(
      (filter.runtimeToolNames ?? [])
        .map((name) => String(name).trim())
        .filter(Boolean),
    );
    const disabledToolNames = new Set(
      (filter.disabledToolNames ?? [])
        .map((name) => String(name).trim())
        .filter(Boolean),
    );
    const enabledCapabilityKinds = new Set(
      (filter.enabledCapabilityKinds ?? [])
        .map((kind) => String(kind).trim())
        .filter(Boolean),
    );
    const includeNormalTools = filter.includeNormalTools !== false;

    return tools.filter((tool) => {
      if (disabledToolNames.has(tool.name)) return false;
      if (tool.runtimeOnly) {
        const explicitlyAvailable = tool.providerKind === 'mcp'
          || [...runtimeToolNames].some(
            (name) =>
              this.schemas.resolveRuntimeName(name, [tool])
                ?.name === tool.name,
          );
        return explicitlyAvailable
          && (!this.requiresWorkspace(tool) || Boolean(workspaceRoot));
      }
      if (!includeNormalTools) return false;
      if (this.requiresWorkspace(tool) && !workspaceRoot) return false;
      if (
        enabledToolNames.size > 0
        && !enabledToolNames.has(tool.name)
      ) {
        return false;
      }
      if (enabledCapabilityKinds.size > 0) {
        const capabilities = tool.capabilityKinds ?? [];
        if (!capabilities.some(
          (kind) => enabledCapabilityKinds.has(kind),
        )) {
          return false;
        }
      }
      return true;
    });
  }

  private turnExposesTool(
    requestJson: unknown,
    tool: Tool,
  ): boolean {
    if (!requestJson || typeof requestJson !== 'object' || Array.isArray(requestJson)) {
      return false;
    }
    const tools = (requestJson as Record<string, unknown>).tools;
    return Array.isArray(tools) && tools.some((value) => (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && this.schemas.resolveRuntimeName(
        String((value as Record<string, unknown>).name ?? ''),
        [tool],
      )?.name === tool.name
    ));
  }

  private checkWorkspace(
    tool: Tool,
    input: AgentToolInvocationRequest,
  ): Extract<AgentToolResult, { status: 'failed' }> | null {
    if (
      this.requiresWorkspace(tool)
      && (
        !input.workspace.rootPath
        || !input.workspace.readAllowed
      )
    ) {
      return {
        status: 'failed',
        errorCode: 'WORKSPACE_REQUIRED',
        message:
          'This tool requires an authorized workspace',
        retryable: false,
      };
    }

    const writes =
      tool.sideEffectClass === 'workspace_write'
      || tool.requiredSurfaces?.includes('workspace') === true
      || tool.name === 'file.write'
      || tool.name === 'file.patch'
      || tool.name === 'file.delete';

    if (
      writes
      && !input.workspace.writeAllowed
    ) {
      return {
        status: 'failed',
        errorCode: 'WORKSPACE_WRITE_DENIED',
        message:
          'Workspace write access is not granted',
        retryable: false,
      };
    }

    return null;
  }


  private requiresApproval(
    tool: Tool,
    _args: Record<string, unknown>,
  ): boolean {
    return tool.requiresApproval === true;
  }

  private requiresWorkspace(tool: Tool): boolean {
    return tool.requiredSurfaces?.includes('workspace') === true
      || tool.name.startsWith('file.')
      || tool.name.startsWith('terminal.')
      || tool.name.startsWith('git.')
      || tool.name === 'python.execute'
      || tool.name === 'workspace.inspect';
  }

  private redact(
    tool: Tool,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const sensitive = new Set(
      tool.sensitiveInputKeys ?? [],
    );
    return Object.fromEntries(
      Object.entries(args).map(([key, value]) => [
        key,
        sensitive.has(key)
          ? '[REDACTED]'
          : value,
      ]),
    );
  }

  private matchesRuntimeToolName(
    requestedName: string,
    canonicalName: string,
  ): boolean {
    const requested = String(requestedName ?? '').trim();
    return requested === canonicalName
      || requested === this.schemas.encodeName(canonicalName);
  }

  private heartbeatMs(): number {
    const raw = Number(
      process.env.SEEKMORE_AGENT_STAGE_HEARTBEAT_MS
      ?? 15_000,
    );
    if (!Number.isFinite(raw)) return 15_000;
    return Math.max(5_000, Math.min(raw, 60_000));
  }
}
