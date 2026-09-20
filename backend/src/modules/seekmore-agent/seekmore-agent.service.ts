                                                   

import { Injectable } from '@nestjs/common';
import { RuntimeFlowTraceLogger } from '../../common/trace/runtime-flow-trace.logger';
import { RuntimeAssistantTimelineBus } from '../chat/runtime-events/runtime-assistant-timeline.bus';
import { RuntimeAccessPolicyService } from '../approval/runtime-access-policy.service';
import type { AgentRuntimeEvent } from './contracts/agent-runtime-event.types';
import type {
  AgentRuntimeMessage,
  AgentRuntimeTurnRequest,
  AgentTurnExecutionInput,
  AgentTurnExecutionResult,
} from './contracts/agent-turn.types';
import { ConversationContextService } from './context/conversation-context.service';
import { MediaTurnPreparationService } from '../media-ai/routing/media-turn-preparation.service';
import { AgentTurnRepository } from './persistence/agent-turn.repository';
import { AgentRuntimeService } from './runtime/agent-runtime.service';
import { AgentRuntimeEventProjectorService } from './runtime/events/agent-runtime-event-projector.service';
import { ConversationLockService } from './session/conversation-lock.service';
import { TurnCancellationService } from './session/turn-cancellation.service';
import { AgentToolRuntimeService } from './tools/agent-tool-runtime.service';
import {
  DEFAULT_LOCALE_CONTEXT,
  type ResolvedLocaleContext,
} from '../localization/locale.types';

const AGENT_EXECUTION_DISCIPLINE = [
  'Use the fewest tool interactions needed to obtain sufficient direct evidence.',
  'When independent checks can be requested safely in the same model turn, request them together instead of investigating them one by one.',
  'Once the current request is supported by sufficient direct evidence, stop investigating and answer. Do not seek redundant confirmation.',
  'If you changed persistent state, verify the resulting state with an appropriate read-only check before claiming success.',
].join(' ');

@Injectable()
export class SeekmoreAgentService {
  constructor(
    private readonly context: ConversationContextService,
    private readonly runtime: AgentRuntimeService,
    private readonly projector: AgentRuntimeEventProjectorService,
    private readonly tools: AgentToolRuntimeService,
    private readonly locks: ConversationLockService,
    private readonly cancellations: TurnCancellationService,
    private readonly turns: AgentTurnRepository,
    private readonly trace: RuntimeFlowTraceLogger,
    private readonly timeline: RuntimeAssistantTimelineBus,
    private readonly accessPolicy: RuntimeAccessPolicyService,
    private readonly media: MediaTurnPreparationService,
  ) {}

  async reconcileTurnResult(
    result: AgentTurnExecutionResult,
    reason: string,
  ): Promise<void> {
    await this.turns.complete(result.traceId, result);

    this.trace.event('seekmore_agent.turn_reconciled', {
      trace: result.traceId,
      conversationId: result.conversationId,
      assistantMessageId: result.assistantMessageId,
      reason,
      outcome:
        result.outcome.kind === 'terminal'
          ? result.outcome.status
          : result.outcome.reason,
    });
  }

  runChatTurn(
    input: AgentTurnExecutionInput,
  ): Promise<AgentTurnExecutionResult> {
    return this.locks.runExclusive(
      input.conversationId,
      () => this.execute(input),
      input.traceId,
      input.abortSignal,
    );
  }

  private async execute(
    input: AgentTurnExecutionInput,
  ): Promise<AgentTurnExecutionResult> {
    const startedAt = Date.now();

    const signal =
      this.cancellations.registerOrGet(
        input.traceId,
        input.abortSignal,
      );

    let stage = 'turn_start';
    let stageStartedAt = startedAt;

    const enterStage = (
      nextStage: string,
      fields: Record<
        string,
        string | number | boolean | null | undefined
      > = {},
    ) => {
      const now = Date.now();

      this.trace.event(
        'seekmore_agent.stage_enter',
        {
          trace: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            input.assistantMessageId,
          stage: nextStage,
          previousStage: stage,
          previousStageMs:
            now - stageStartedAt,
          elapsedMs:
            now - startedAt,
          ...fields,
        },
      );

      stage = nextStage;
      stageStartedAt = now;
    };

    const heartbeat = setInterval(
      () => {
        this.trace.warn(
          'seekmore_agent.turn_heartbeat',
          {
            trace: input.traceId,
            conversationId:
              input.conversationId,
            assistantMessageId:
              input.assistantMessageId,
            stage,
            stageMs:
              Date.now() - stageStartedAt,
            elapsedMs:
              Date.now() - startedAt,
          },
        );
      },
      this.heartbeatMs(),
    );

    heartbeat.unref?.();

    this.trace.event(
      'seekmore_agent.turn_start',
      {
        trace: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId:
          input.conversationId,
        userMessageId:
          input.userMessageId,
        assistantMessageId:
          input.assistantMessageId,
        engine: 'typescript',
      },
    );

    this.projectStatus(
      input,
      'Understanding the task and preparing the runtime…',
      'turn_start',
    );

    try {
      throwIfAborted(signal);

      enterStage('access_policy_resolve');

      const preparedPolicy =
        await this.accessPolicy.resolveForTurnPreparation({
          traceId: input.traceId,
          userId: input.userId,
          conversationId: input.conversationId,
        });
      const hasWorkspaceSnapshot =
        Object.prototype.hasOwnProperty.call(
          input.runtimeOptions ?? {},
          'workspaceId',
        );
      const effectiveInput: AgentTurnExecutionInput = {
        ...input,
        runtimeOptions: {
          ...input.runtimeOptions,
          workspaceId: hasWorkspaceSnapshot
            ? input.runtimeOptions?.workspaceId ?? null
            : preparedPolicy.workspaceId,
          permissionMode: preparedPolicy.permissionMode,
          accessPolicyVersion: preparedPolicy.policyVersion,
        },
      };

      enterStage('context_build', {
        accessPolicyVersion: preparedPolicy.policyVersion,
        workflowId: preparedPolicy.workflowId,
      });

      this.projectStatus(
        effectiveInput,
        'Loading conversation, agent configuration, and workspace context…',
        'context_build',
      );

      const assembled =
        await this.context.build(effectiveInput);

      throwIfAborted(signal);

      enterStage('request_build', {
        historyMessages:
          assembled.branch.messages.length,
        provider:
          assembled.agent.provider,
        model:
          assembled.agent.model,
        workspaceResolved:
          Boolean(
            assembled.workspace?.rootPath,
          ),
      });

      const request =
        await this.request(
          effectiveInput,
          assembled,
        );

      this.trace.event(
        'seekmore_agent.request_built',
        {
          trace: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            input.assistantMessageId,
          messageCount:
            request.messages.length,
          toolCount:
            request.tools.length,
          provider:
            request.agent.provider,
          model:
            request.agent.model,
          apiMode:
            request.agent.apiMode,
          workspaceId:
            request.workspace.workspaceId,
          workspaceResolved:
            Boolean(
              request.workspace.rootPath,
            ),
          maxIterations:
            request.maxIterations,
          firstTokenTimeoutS:
            request.timeouts.firstToken,
          idleTimeoutS:
            request.timeouts.idle,
          modelTotalTimeoutS:
            request.timeouts.modelTotal,
          toolTimeoutS:
            request.timeouts.tool,
        },
      );

      enterStage(
        'turn_persistence_start',
      );

      await this.turns.start(request);

      this.trace.event(
        'seekmore_agent.turn_persistence_ready',
        {
          trace: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            input.assistantMessageId,
          durationMs:
            Date.now() - stageStartedAt,
        },
      );

      enterStage('runtime_start');

      this.projectStatus(
        input,
        request.tools.length
          ? `Runtime is ready. Analyzing the task and selecting from ${request.tools.length} available tools…`
          : 'Runtime is ready. Analyzing the task…',
        'runtime_start',
        {
          toolCount:
            request.tools.length,
        },
      );

      const deliveredObjectIds = new Set<string>();

      const execution =
        await this.runtime.run(
          request,
          {
            signal,
            onContentDelta:
              input.onToken,

            onEvent: async (
              event,
            ) => {
              this.projector.project({
                userId: input.userId,
                event,
              });

                                             
                                                   
                                               
              if (
                event.type === 'iteration.summary'
                || event.type === 'iteration.completed'
              ) {
                await this.timeline.flush(input.assistantMessageId);
              }

              if (
                event.type === 'tool.completed'
                && event.result.status === 'completed'
                && input.onObjects
              ) {
                const producedObjects: Array<Record<string, unknown>> = [];

                for (const value of event.result.objects ?? []) {
                  const object = this.record(value);
                  const objectId = String(object.objectId ?? '').trim();
                  const role = String(object.role ?? '').trim();

                  if (
                    !objectId
                    || role !== 'assistant_output'
                    || deliveredObjectIds.has(objectId)
                  ) {
                    continue;
                  }

                  deliveredObjectIds.add(objectId);
                  producedObjects.push({
                    ...object,
                    objectId,
                    role: 'assistant_output',
                  });
                }

                if (producedObjects.length > 0) {
                  await input.onObjects(producedObjects);
                }
              }

              if (
                event.type
                  !== 'content.delta'
                && event.type
                  !== 'reasoning.delta'
              ) {
                const fields =
                  this.runtimeEventFields(
                    event,
                  );

                this.trace.event(
                  'seekmore_agent.runtime_event',
                  {
                    trace:
                      input.traceId,
                    conversationId:
                      input.conversationId,
                    assistantMessageId:
                      input.assistantMessageId,
                    type:
                      event.type,
                    elapsedMs:
                      Date.now()
                      - startedAt,
                    ...fields,
                  },
                );

                if (
                  event.type
                  === 'model.started'
                ) {
                  stage =
                    `model_iteration_${
                      String(
                        event.detail
                          .iteration
                        ?? '?',
                      )
                    }`;

                  stageStartedAt =
                    Date.now();
                } else if (
                  event.type
                    === 'tool.requested'
                  || event.type
                    === 'tool.started'
                ) {
                  stage =
                    `tool_${event.call.name}`;

                  stageStartedAt =
                    Date.now();
                } else if (
                  event.type
                    === 'tool.completed'
                  || event.type
                    === 'tool.failed'
                ) {
                  stage =
                    'observation_processing';

                  stageStartedAt =
                    Date.now();
                }
              }
            },
          },
        );

      enterStage(
        'turn_persistence_complete',
        {
          iterations:
            execution.iterations,
          toolCallCount:
            execution.toolCallCount,
          contentLen:
            execution.content.length,
        },
      );

      const usedMemoryIds = Array.isArray(execution.metadata.usedMemoryIds)
        ? execution.metadata.usedMemoryIds.filter((id): id is string => typeof id === 'string') : [];

      const result:
        AgentTurnExecutionResult = {
          traceId:
            input.traceId,
          conversationId:
            input.conversationId,
          userMessageId:
            input.userMessageId,
          assistantMessageId:
            input.assistantMessageId,
          content:
            execution.content,
          citations:
            execution.citations,
          objects:
            execution.objects,
          runtime: {
            ...this.record(execution.runtimePatch),
            engine:
              'seekmore-agent-runtime-ts',
            kernelSessionId:
              input.conversationId,
            agentId:
              input.agentId,
            conversationId:
              input.conversationId,
            metadata:
              execution.metadata,
            usage:
              execution.usage,
            iterations:
              execution.iterations,
            toolCallCount:
              execution.toolCallCount,
            toolExecutions:
              execution.toolExecutions,
            usedMemoryIds,
            timeline:
              this.timeline.snapshot(
                input.assistantMessageId,
              ),
            deliverySnapshot: {
              selectedCitationCount:
                execution.citations.length,
              observedCitationCount:
                execution
                  .observedCitationCount,
              objectCount:
                execution.objects.length,
              toolExecutionCount:
                execution
                  .toolExecutions
                  .length,
            },
          },
          metadata:
            execution.metadata,
          warnings:
            execution.warnings,
          reasonCodes:
            execution.reasonCodes,
          outcome:
            execution.outcome,
        };

      await this.turns.complete(
        input.traceId,
        result,
      );

      enterStage('turn_done');

      this.trace.event(
        'seekmore_agent.turn_done',
        {
          trace: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            input.assistantMessageId,
          contentLen:
            result.content.length,
          outcome:
            result.outcome.kind
              === 'terminal'
              ? result.outcome.status
              : result.outcome.reason,
          iterations:
            execution.iterations,
          toolCallCount:
            execution.toolCallCount,
          elapsedMs:
            Date.now() - startedAt,
          engine: 'typescript',
        },
      );

      return result;
    } catch (error) {
      const cancelled =
        signal.aborted
        || (
          error instanceof Error
          && error.name === 'AbortError'
        );

      const failedStage = stage;

      const failedStageMs =
        Date.now() - stageStartedAt;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.trace.error(
        'seekmore_agent.turn_failed',
        {
          trace: input.traceId,
          conversationId:
            input.conversationId,
          assistantMessageId:
            input.assistantMessageId,
          stage:
            failedStage,
          stageMs:
            failedStageMs,
          elapsedMs:
            Date.now() - startedAt,
          error:
            message,
          engine:
            'typescript',
        },
      );

      if (!cancelled) {
        this.projector.project({
          userId: input.userId,
          event: {
            type:
              'turn.failed',
            traceId:
              input.traceId,
            conversationId:
              input.conversationId,
            userMessageId:
              input.userMessageId,
            assistantMessageId:
              input.assistantMessageId,
            timestamp:
              Date.now(),
            errorCode:
              this.errorCode(error),
            message,
            detail: {
              stage:
                failedStage,
              stageMs:
                failedStageMs,
            },
          },
        });
      }

      stage = 'turn_failed';
      stageStartedAt = Date.now();

      await (
        cancelled
          ? this.turns.cancel(
              input.traceId,
              signal.reason,
            )
          : this.turns.fail(
              input.traceId,
              error,
            )
      ).catch(
        () => undefined,
      );

      throw error;
    } finally {
      clearInterval(heartbeat);

      this.cancellations.clear(
        input.traceId,
      );
    }
  }

  private async request(
    input: AgentTurnExecutionInput,
    assembled: Awaited<
      ReturnType<
        ConversationContextService[
          'build'
        ]
      >
    >,
  ): Promise<AgentRuntimeTurnRequest> {
    const rootPath =
      assembled.workspace?.rootPath
      ?? null;

    const permissionMode =
      input.runtimeOptions
        ?.permissionMode
      ?? 'confirm_required';

    const externalContext =
      this.record(input.externalContext);
    const localization: ResolvedLocaleContext =
      input.localization ?? DEFAULT_LOCALE_CONTEXT;
    const isWorkflowAutoTurn =
      String(
        externalContext.source
        ?? '',
      ).trim() === 'workflow_auto';

    const memoryMessages: AgentRuntimeMessage[] =
      assembled.memory.blocks.map((block) => ({
        role: 'system' as const,
        content: {
          runtimeContextType: 'relevant_memory',
          content: block.content,
          itemCount: block.metadata.itemCount,
          usedMemoryIds: block.metadata.usedMemoryIds,
        },
      }));

    const messages:
      AgentRuntimeMessage[] = [
        ...(
          isWorkflowAutoTurn
            ? []
            : [{
                role: 'system' as const,
                content: {
                  runtimeContextType: 'current_turn_policy',
                  currentWorkspaceId:
                    assembled.workspace?.workspaceId
                    ?? null,
                  rules: [
                    'The latest user request is the authoritative objective for this turn.',
                    'Earlier requests, plans, pending steps, targets, and tool trajectories are historical context unless the latest request explicitly or contextually depends on them.',
                    'Current runtime state is authoritative for new execution and overrides conflicting historical runtime state.',
                    'Use earlier conversation content to resolve continuity and references, but never continue unfinished prior work on its own.',
                  ],
                },
              }]
        ),
        ...memoryMessages,
        ...assembled.branch.messages,
      ];

    if (
      input.externalContext
      && Object.keys(input.externalContext).length
    ) {
      messages.push({
        role: 'system',
        content: {
          runtimeContextType: 'external_context',
          data: input.externalContext,
        },
      });
    }

    if (localization.language) {
      messages.push({
        role: 'system',
        content: {
          runtimeContextType: 'communication_language',
          language: localization.language,
          instruction:
            'Use this as the default language for reasoning summaries and user-facing responses. A clear user request to use another language overrides this default.',
        },
      });
    }

    const media = await this.media.prepare({
      traceId: input.traceId,
      assistantMessageId: input.assistantMessageId,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      userInput: input.input,
      primary: assembled.agent.modelConfig,
      attachedObjects: assembled.branch.inputObjects,
      workflowActive: Boolean(
        input.externalContext?.seekmoreWorkflow
        || input.externalContext?.workflow
        || input.externalContext?.workflowId,
      ),
      signal: input.abortSignal,
    });
    messages.push({
      role: 'system',
      content: media.capabilityContext,
    });

    const requestedRuntimeTools =
      input.runtimeOptions?.runtimeToolNames;

    const runtimeToolNames = [
      ...new Set([
        ...(requestedRuntimeTools ?? []),
        ...(
          assembled.agent.toolEnabled
          && assembled.agent.knowledgeAvailable
            ? ['knowledge.search']
            : []
        ),
      ]),
    ];

    const definitions =
      await this.tools
        .listDefinitionsForUser({
          userId:
            input.userId,
          agentId:
            input.agentId,
          toolEnabled:
            assembled.agent
              .toolEnabled,
          workspaceRoot:
            rootPath,
          enabledToolNames:
            input.runtimeOptions
              ?.enabledToolNames,
          runtimeToolNames,
          disabledToolNames: [
            ...(input.runtimeOptions?.disabledToolNames ?? []),
            ...media.disabledToolNames,
          ],
          enabledCapabilityKinds:
            input.runtimeOptions
              ?.enabledCapabilityKinds,
        });

    return {
      traceId:
        input.traceId,
      userId:
        input.userId,
      agentId:
        input.agentId,
      conversationId:
        input.conversationId,
      userMessageId:
        input.userMessageId,
      assistantMessageId:
        input.assistantMessageId,
      parentMessageId:
        input.parentMessageId,
      branchId:
        assembled.branch.branchId,
      branchObjectIds:
        assembled.branch.branchObjectIds,
      input:
        input.input,
      messages,
      agent: {
        name:
          assembled.agent.name,
        instructions: [
          assembled.agent
            .instructions,
          AGENT_EXECUTION_DISCIPLINE,
        ]
          .filter(Boolean)
          .join('\n\n'),
        model:
          assembled.agent.model,
        provider:
          assembled.agent.provider,
        baseUrl:
          assembled.agent.baseUrl,
        apiKey:
          assembled.agent.apiKey,
        temperature:
          assembled.agent
            .temperature,
        maxTokens:
          assembled.agent
            .maxTokens,
        apiMode:
          assembled.agent.apiMode,
        contextWindow:
          assembled.agent
            .contextWindow,
        reasoningEffort:
          assembled.agent
            .reasoningEffort,
        headers:
          assembled.agent.headers,
        protocol:
          assembled.agent.protocol,
        capabilities:
          assembled.agent.modelCapabilities,
        fallbacks:
          assembled.agent
            .fallbacks,
      },
      workspace: {
        workspaceId:
          assembled.workspace
            ?.workspaceId
          ?? null,
        rootPath,
        readAllowed:
          Boolean(rootPath),
        writeAllowed:
          Boolean(
            rootPath
            && assembled.workspace
              ?.writable !== false,
          ),
      },
      permissionMode,
      accessPolicyVersion: Math.max(
        1,
        Number(input.runtimeOptions?.accessPolicyVersion ?? 1),
      ),
      tools:
        definitions,
      attachedObjects:
        media.attachedObjects,
      localization,
      maxIterations:
        Math.max(
          1,
          Math.min(
            input.runtimeOptions
              ?.toolDecisionMaxIterations
            ?? 90,
            200,
          ),
        ),
      timeouts: {
        firstToken:
          Number(
            process.env
              .SEEKMORE_AGENT_FIRST_TOKEN_TIMEOUT_S
            ?? 120,
          ),
        idle:
          Number(
            process.env
              .SEEKMORE_AGENT_IDLE_TIMEOUT_S
            ?? 900,
          ),
        modelTotal:
          Number(
            process.env
              .SEEKMORE_AGENT_MODEL_TOTAL_TIMEOUT_S
            ?? process.env
              .SEEKMORE_AGENT_TOTAL_TIMEOUT_S
            ?? 1800,
          ),
        tool:
          Number(
            process.env
              .SEEKMORE_AGENT_TOOL_TIMEOUT_S
            ?? 900,
          ),
      },
    };
  }

  private projectStatus(
    input: AgentTurnExecutionInput,
    content: string,
    stage: string,
    detail: Record<
      string,
      unknown
    > = {},
  ): void {
    this.projector.project({
      userId:
        input.userId,
      event: {
        type:
          'status',
        traceId:
          input.traceId,
        conversationId:
          input.conversationId,
        userMessageId:
          input.userMessageId,
        assistantMessageId:
          input.assistantMessageId,
        timestamp:
          Date.now(),
        content,
        detail: {
          stage,
          ...detail,
        },
      },
    });
  }

  private runtimeEventFields(
    event: AgentRuntimeEvent,
  ): Record<
    string,
    string | number | boolean | null | undefined
  > {
    if (
      event.type
      === 'model.started'
    ) {
      return {
        iteration:
          Number(
            event.detail.iteration
            ?? 0,
          ),
        provider:
          String(
            event.detail.provider
            ?? '',
          ),
        model:
          String(
            event.detail.model
            ?? '',
          ),
      };
    }

    if (
      event.type
        === 'tool.requested'
      || event.type
        === 'tool.started'
      || event.type
        === 'tool.completed'
      || event.type
        === 'tool.failed'
    ) {
      return {
        toolCallId:
          event.call.id,
        tool:
          event.call.name,
        resultStatus:
          'result' in event
            ? event.result.status
            : null,
      };
    }

    if (
      event.type
      === 'turn.failed'
    ) {
      return {
        errorCode:
          event.errorCode,
        message:
          event.message,
      };
    }

    return {};
  }

  private errorCode(
    error: unknown,
  ): string {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
    ) {
      const code = String(
        (
          error as {
            code?: unknown;
          }
        ).code
        ?? '',
      ).trim();

      if (code) {
        return code;
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    const prefix =
      message
        .split(':', 1)[0]
        ?.trim();

    return (
      prefix
      && /^[A-Z0-9_]+$/.test(
        prefix,
      )
    )
      ? prefix
      : 'SEEKMORE_AGENT_TURN_FAILED';
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private heartbeatMs(): number {
    const raw = Number(
      process.env
        .SEEKMORE_AGENT_STAGE_HEARTBEAT_MS
      ?? 15_000,
    );

    if (!Number.isFinite(raw)) {
      return 15_000;
    }

    return Math.max(
      5_000,
      Math.min(
        raw,
        60_000,
      ),
    );
  }
}

function throwIfAborted(
  signal?: AbortSignal,
): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error(
    'AGENT_TURN_CANCELLED',
  );

  error.name = 'AbortError';

  throw error;
}