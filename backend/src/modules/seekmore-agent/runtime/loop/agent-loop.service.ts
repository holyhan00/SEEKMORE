// backend/src/modules/seekmore-agent/runtime/loop/agent-loop.service.ts
import { Injectable } from '@nestjs/common';
import { RuntimeFlowTraceLogger } from '../../../../common/trace/runtime-flow-trace.logger';
import type {
  AgentRuntimeToolCall,
  AgentRuntimeTurnRequest,
} from '../../contracts/agent-turn.types';
import type { AgentRuntimeEvent } from '../../contracts/agent-runtime-event.types';
import type {
  AgentToolExecutionRecord,
  AgentToolResult,
} from '../../contracts/agent-tool.types';
import type {
  AgentRuntimeHooks,
  AgentRuntimeRunResult,
} from '../agent-runtime.types';
import { AgentTurnRepository } from '../../persistence/agent-turn.repository';
import { ContextResolverService } from '../context/context-resolver.service';
import { WorldStateResolverService } from '../context/world-state-resolver.service';
import { CapabilityResolverService, CAPABILITY_SEARCH, capabilitySearchDefinition } from '../tools/capability-resolver.service';
import { AgentDeliveryCollector } from '../delivery/agent-delivery.collector';
import {
  AgentRuntimeError,
  ContextWindowExceededError,
} from '../errors/agent-runtime.errors';
import { ModelGatewayService } from '../model/model-gateway.service';
import type { ModelGenerationResult } from '../model/model.types';
import { ToolExecutionCoordinatorService } from '../tools/tool-execution-coordinator.service';
import { ToolObservationBuilder } from '../tools/tool-observation.builder';
import {
  hash,
  stableStringify,
} from '../util/runtime.util';
import { assessMutationEvidence } from '../verification/verification-evidence';
import { VerificationStopService } from '../verification/verification-stop.service';
import { AgentLoopState, userInputContent } from './agent-loop-state';
import { projectAgentObject } from '../../context/runtime-object-context';
import { ProgressDetectorService } from './progress-detector.service';

const CLARIFICATION_TOOL = 'seekmore_request_user_input';

@Injectable()
export class AgentLoopService {
  constructor(
    private readonly turns: AgentTurnRepository,
    private readonly models: ModelGatewayService,
    private readonly context: ContextResolverService,
    private readonly world: WorldStateResolverService,
    private readonly capabilities: CapabilityResolverService,
    private readonly tools: ToolExecutionCoordinatorService,
    private readonly observations: ToolObservationBuilder,
    private readonly progress: ProgressDetectorService,
    private readonly verification: VerificationStopService,
    private readonly delivery: AgentDeliveryCollector,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async run(
    request: AgentRuntimeTurnRequest,
    hooks: AgentRuntimeHooks,
  ): Promise<AgentRuntimeRunResult> {
    const state = new AgentLoopState(request);
    const restored = await this.turns.restore(request.traceId);
    if (restored) state.restore(restored);
    const startedAt = Date.now();

    this.trace.event('agent_loop.start', {
      trace: request.traceId,
      conversationId: request.conversationId,
      assistantMessageId: request.assistantMessageId,
      messageCount: state.messages.length,
      toolCount: request.tools.length,
      maxIterations: request.maxIterations,
      modelTotalTimeoutS: request.timeouts.modelTotal,
    });

    await this.emit(request, hooks, {
      type: 'turn.started',
      detail: {
        engine: 'typescript',
        startedAt,
      },
    });

    try {
      while (state.budget.canCallModel()) {
        this.assertActive(hooks.signal);

        state.iteration += 1;
        state.beginIteration();
        await this.consumeInputs(state);
        if (!restored && state.iteration === 1) {
          await this.turns.checkpoint(
            request.traceId,
            state.snapshot('ready'),
          );
        }

        const iterationStartedAt = Date.now();

        this.trace.event('agent_loop.iteration_start', {
          trace: request.traceId,
          conversationId: request.conversationId,
          assistantMessageId:
            request.assistantMessageId,
          iteration: state.iteration,
          messageCount: state.messages.length,
          toolExecutions: state.toolExecutions.length,
          noProgressStreak: state.noProgressStreak,
          elapsedMs: Date.now() - startedAt,
        });

        await this.emit(request, hooks, {
          type: 'status',
          content:
            state.iteration === 1
              ? 'Analyzing the task and preparing the execution path…'
              : `Running analysis iteration ${state.iteration}…`,
          detail: {
            stage: 'iteration',
            iteration: state.iteration,
          },
        });

        state.budget.recordModelCall();

        await this.emit(request, hooks, {
          type: 'model.started',
          detail: {
            iteration: state.iteration,
            provider: request.agent.provider,
            model: request.agent.model,
            budget: state.budget.snapshot(),
          },
        });

        let response: ModelGenerationResult;

        const modelStartedAt = Date.now();

        this.trace.event('agent_loop.model_call_start', {
          trace: request.traceId,
          conversationId: request.conversationId,
          assistantMessageId:
            request.assistantMessageId,
          iteration: state.iteration,
          provider: request.agent.provider,
          model: request.agent.model,
          messageCount: state.messages.length,
          toolCount: request.tools.length + 1,
          elapsedMs: Date.now() - startedAt,
        });

        try {
          response = await this.callModel(
            request,
            state,
            hooks,
            true,
          );

          this.trace.event(
            'agent_loop.model_call_done',
            {
              trace: request.traceId,
              conversationId:
                request.conversationId,
              assistantMessageId:
                request.assistantMessageId,
              iteration: state.iteration,
              durationMs:
                Date.now() - modelStartedAt,
              contentLen: response.content.length,
              reasoningLen:
                response.reasoning.length,
              toolCallCount:
                response.toolCalls.length,
              finishReason: response.finishReason,
            },
          );
        } catch (error) {
          this.trace.warn(
            'agent_loop.model_call_failed',
            {
              trace: request.traceId,
              conversationId:
                request.conversationId,
              assistantMessageId:
                request.assistantMessageId,
              iteration: state.iteration,
              durationMs:
                Date.now() - modelStartedAt,
              error:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
          );

          if (
            error instanceof
              ContextWindowExceededError &&
            state.contextRetries < 3
          ) {
            state.contextRetries += 1;

            state.reasonCodes.push('agent:context_projection_retry');

            continue;
          }

          if (state.visibleContent.trim()) {
            state.warnings.push(
              error instanceof Error
                ? error.message
                : String(error),
            );

            state.reasonCodes.push(
              'agent:model_stream_interrupted_partial',
            );

            return this.result(state, 'partial', startedAt);
          }

          throw error;
        }

        state.mergeUsage(response.usage);

        if (response.reasoning) {
          state.reasoning += response.reasoning;
        }

        const clarification =
          response.toolCalls.find(
            (call) =>
              call.name === CLARIFICATION_TOOL,
          );
        const toolCalls = clarification
          ? [clarification]
          : this.tools.select(
              request,
              response.toolCalls,
            );

        state.appendAssistant(
          response.content,
          response.toolCalls,
          response.reasoning,
        );

        await this.turns.journal(request.traceId, 'model.decision', state.iteration, {
          content: response.content, toolCalls: response.toolCalls, usage: response.usage,
          durationMs: Date.now() - modelStartedAt,
        });
        const selectedIds = new Set(toolCalls.map((call) => call.id));
        await this.skipCalls(state, response.toolCalls.filter((call) => !selectedIds.has(call.id)),
          'Another call requires exclusive execution or user clarification. This call was not executed.');

        if (clarification) {
          state.pendingClarificationId = clarification.id;
          await this.turns.checkpoint(request.traceId, state.snapshot('waiting_user'));
          const question = String(
            clarification.arguments.question ??
              clarification.arguments.prompt ??
              response.content ??
              '',
          ).trim();

          if (
            question &&
            !state.visibleContent.endsWith(question)
          ) {
            state.appendVisible(question);

            await hooks.onContentDelta?.(question);

            await this.emit(request, hooks, {
              type: 'content.delta',
              content: question,
            });
          }

          await this.emit(request, hooks, {
            type: 'clarification',
            content:
              question || '',
          });

          state.reasonCodes.push(
            'agent:clarification_required',
          );

          return this.pausedResult(
            state,
            question,
            startedAt,
          );
        }

        if (toolCalls.length) {
          if (state.lengthContinuations > 0) {
            state.finalContent = '';
            state.lengthContinuations = 0;
          }

          const iterationSummary = String(
            response.content || state.iterationContent || '',
          ).trim();

          if (iterationSummary) {
            await this.emit(request, hooks, {
              type: 'iteration.summary',
              iteration: state.iteration,
              content: iterationSummary,
            });
          }
          state.emptyResponses = 0;

          if (
            !state.budget.canExecuteTools(
              toolCalls.length,
            )
          ) {
            state.warnings.push(
              'Tool-call budget exhausted',
            );

            state.reasonCodes.push(
              'agent:tool_budget_exhausted',
            );

            await this.skipCalls(state, toolCalls, 'Tool-call budget exhausted. This call was not executed.');
            break;
          }

          await this.emit(request, hooks, {
            type: 'status',
            content: `Executing ${toolCalls.length} selected tool(s)…`,
            detail: {
              stage: 'tools',
              iteration: state.iteration,
              toolCallCount:
                toolCalls.length,
            },
          });

          const toolsStartedAt = Date.now();

          this.trace.event('agent_loop.tools_start', {
            trace: request.traceId,
            conversationId:
              request.conversationId,
            assistantMessageId:
              request.assistantMessageId,
            iteration: state.iteration,
            toolCallCount:
              toolCalls.length,
            tools: toolCalls
              .map((call) => call.name)
              .join(','),
          });

          await this.turns.checkpoint(request.traceId, state.snapshot('executing_tools'));
          await this.turns.journal(request.traceId, 'tools.dispatched', state.iteration, { toolCalls });
          const records = await this.executeTools(
            request,
            state,
            toolCalls,
            hooks,
          );

          this.trace.event('agent_loop.tools_done', {
            trace: request.traceId,
            conversationId:
              request.conversationId,
            assistantMessageId:
              request.assistantMessageId,
            iteration: state.iteration,
            durationMs:
              Date.now() - toolsStartedAt,
            toolCallCount: records.length,
            failedCount: records.filter(
              (record) =>
                record.result.status === 'failed',
            ).length,
          });

          state.budget.recordToolCalls(
            records.length,
          );

          await this.turns.journal(request.traceId, 'tools.observed', state.iteration, { records });
          const iterationFinishedAt = Date.now();
          await this.emit(request, hooks, {
            type: 'iteration.completed',
            iteration: state.iteration,
            detail: {
              toolCallCount: records.length,
              failedCount: records.filter(
                (record) => record.result.status === 'failed',
              ).length,
              startedAt: iterationStartedAt,
              finishedAt: iterationFinishedAt,
              durationMs: Math.max(
                0,
                iterationFinishedAt - iterationStartedAt,
              ),
            },
          });

          for (const record of records) {
            state.appendTool(
              this.observations.message(
                record.call,
                record.result,
              ),
              record,
            );
          }

          const finishing = records.find(
            (record) => record.finishTurn,
          );

          if (finishing) {
            await this.turns.checkpoint(
              request.traceId,
              state.snapshot('ready'),
            );
          }

          if (finishing && await this.turns.sealInputs(request.traceId)) {
            const message = this.finishMessage(
              finishing.result,
            );

            if (
              message
              && !state.visibleContent
                .trim()
                .endsWith(message)
            ) {
              const delta = state.visibleContent.trim()
                ? `\n\n${message}`
                : message;

              state.appendVisible(delta);
              await hooks.onContentDelta?.(delta);
              await this.emit(request, hooks, {
                type: 'content.delta',
                content: delta,
              });
            }

            state.finalContent =
              state.visibleContent || message;
            state.reasonCodes.push(
              'agent:tool_finished_turn',
            );

            return this.result(
              state,
              'succeeded',
              startedAt,
            );
          }

          const progress = this.progress.record(
            state.toolFingerprintCounts,
            records,
          );

          state.noProgressStreak =
            progress.progressed
              ? 0
              : state.noProgressStreak + 1;

          if (progress.duplicateCount) {
            state.reasonCodes.push(
              'agent:duplicate_observation_ignored_for_progress',
            );
          }

          if (progress.allFailed) {
            state.warnings.push(
              'Every tool call in the iteration failed',
            );
          }

          const verification =
            this.verification.observe(
              state.toolExecutions,
              request.workspace.rootPath,
            );

          if (verification.mutated) {
            state.lastMutationIteration =
              state.iteration;
          }

          if (verification.verified) {
            state.lastVerificationIteration =
              state.iteration;
          }

          if (
            verification.mutated
            || verification.verified
            || verification.unknownExecution
          ) {
            this.trace.event(
              'agent_loop.verification_observed',
              {
                trace: request.traceId,
                conversationId:
                  request.conversationId,
                assistantMessageId:
                  request.assistantMessageId,
                iteration: state.iteration,
                mutated: verification.mutated,
                verified: verification.verified,
                unknownExecution:
                  verification.unknownExecution,
                lastMutationIteration:
                  state.lastMutationIteration,
                lastVerificationIteration:
                  state.lastVerificationIteration,
              },
            );
          }

          if (state.noProgressStreak >= 3) {
            state.messages.push({
              role: 'system',
              content:
                'The last tool actions did not produce new evidence. Do not repeat the same call. Select a different capability, revise the approach, or provide the best truthful final answer from the evidence already collected.',
            });

            state.reasonCodes.push(
              'agent:no_progress_reselection_required',
            );
          }

          // Tool side effects and their observations are now part of the canonical trajectory.
          // Persist a resumable boundary before the next model call so recovery never needs to
          // replay a completed tool execution.
          await this.turns.checkpoint(
            request.traceId,
            state.snapshot('ready'),
          );

          if (state.noProgressStreak >= 5) {
            state.warnings.push(
              'Agent loop stopped after repeated no-progress observations',
            );

            state.reasonCodes.push(
              'agent:no_progress_stop',
            );

            break;
          }

          continue;
        }

        if (response.finishReason === 'length') {
          state.finalContent += response.content;
          state.lengthContinuations += 1;

          if (state.lengthContinuations <= 3) {
            state.messages.push({
              role: 'system',
              content:
                'Continue exactly from where the response stopped. Do not repeat completed text. Complete the task or issue required tool calls.',
            });

            state.reasonCodes.push(
              'agent:length_continuation',
            );

            continue;
          }

          state.warnings.push(
            'Model repeatedly reached its output limit',
          );

          state.reasonCodes.push(
            'agent:length_limit_exhausted',
          );

          break;
        }

        if (!response.content.trim()) {
          state.emptyResponses += 1;

          if (state.emptyResponses <= 2) {
            state.messages.push({
              role: 'system',
              content:
                'The previous model response was empty. Continue the task now. Use tools when evidence or execution is required; otherwise provide the final answer.',
            });

            continue;
          }

          throw new AgentRuntimeError(
            'MODEL_EMPTY_RESPONSE',
            'Model returned repeated empty responses',
            false,
          );
        }

        if (
          this.verification.needsVerification({
            lastMutationIteration:
              state.lastMutationIteration,
            lastVerificationIteration:
              state.lastVerificationIteration,
            alreadyNudged:
              state.verificationNudged,
          })
        ) {
          state.verificationNudged = true;

          state.messages.push({
            role: 'system',
            content: this.verification.nudge(),
          });

          state.reasonCodes.push(
            'agent:verification_required_before_stop',
          );

          await this.emit(request, hooks, {
            type: 'verification.required',
            detail: {
              lastMutationIteration:
                state.lastMutationIteration,
              lastVerificationIteration:
                state.lastVerificationIteration,
              verificationNudged:
                state.verificationNudged,
            },
          });

          continue;
        }

        if (!await this.turns.sealInputs(request.traceId)) {
          state.finalContent = '';
          continue;
        }
        const finalContent = state.lengthContinuations > 0
          ? `${state.finalContent}${response.content}`
          : response.content;
        state.finalContent = finalContent;

        if (
          state.contentMode === 'stream'
          && finalContent.trim()
          && !state.visibleContent.trim()
        ) {
          state.appendVisible(finalContent);
          await hooks.onContentDelta?.(finalContent);
          await this.emit(request, hooks, {
            type: 'content.delta',
            content: finalContent,
          });
        }

        state.reasonCodes.push(
          'agent:completed',
        );

        this.trace.event(
          'agent_loop.iteration_terminal',
          {
            trace: request.traceId,
            conversationId:
              request.conversationId,
            assistantMessageId:
              request.assistantMessageId,
            iteration: state.iteration,
            iterationMs:
              Date.now() - iterationStartedAt,
            contentLen: response.content.length,
          },
        );

        return this.result(
          state,
          hooks.signal?.aborted
            ? 'cancelled'
            : 'succeeded',
          startedAt,
        );
      }

      await this.consumeInputs(state);
      if (
        state.budget.takeGraceCall() &&
        !hooks.signal?.aborted
      ) {
        state.messages.push({
          role: 'system',
          content:
            'The execution budget is exhausted. Do not call tools. Return the best complete and truthful final answer using the evidence already collected. Clearly state any unresolved limitation.',
        });

        try {
          const response = await this.callModel(
            request,
            state,
            hooks,
            false,
          );

          state.mergeUsage(response.usage);
          await this.turns.journal(request.traceId, 'model.decision', state.iteration, { content: response.content, toolCalls: response.toolCalls, usage: response.usage, grace: true });
          state.appendAssistant(
            response.content,
            response.toolCalls,
            response.reasoning,
          );
          await this.skipCalls(state, response.toolCalls, 'Final response sampling does not permit tool execution.');

          if (response.content.trim()) {
            state.finalContent = `${state.finalContent}${response.content}`;
          }
        } catch (error) {
          state.warnings.push(
            error instanceof Error
              ? error.message
              : String(error),
          );
        }
      }

      const status = hooks.signal?.aborted
        ? 'cancelled'
        : (state.visibleContent || state.finalContent).trim()
          ? 'partial'
          : 'failed';

      state.reasonCodes.push(
        status === 'cancelled'
          ? 'agent:cancelled'
          : status === 'partial'
            ? 'agent:iteration_budget_partial'
            : 'agent:iteration_budget_failed',
      );

      return this.result(state, status, startedAt);
    } catch (error) {
      const normalized =
        error instanceof AgentRuntimeError
          ? error
          : new AgentRuntimeError(
              'AGENT_LOOP_FAILED',
              error instanceof Error
                ? error.message
                : String(error),
              false,
              error,
            );

      if (
        hooks.signal?.aborted ||
        normalized.code === 'AGENT_CANCELLED' ||
        normalized.code === 'MODEL_CANCELLED'
      ) {
        state.reasonCodes.push(
          'agent:cancelled',
        );

        state.warnings.push(
          normalized.message,
        );

        return this.result(
          state,
          'cancelled',
          startedAt,
        );
      }

      this.trace.error('agent_loop.failed', {
        trace: request.traceId,
        conversationId: request.conversationId,
        assistantMessageId:
          request.assistantMessageId,
        iteration: state.iteration,
        elapsedMs: Date.now() - startedAt,
        errorCode: normalized.code,
        error: normalized.message,
      });

      const finishedAt = Date.now();

      await this.emit(request, hooks, {
        type: 'turn.failed',
        errorCode: normalized.code,
        message: normalized.message,
        detail: {
          retryable: normalized.retryable,
          timing: {
            startedAt,
            finishedAt,
            durationMs: Math.max(0, finishedAt - startedAt),
          },
        },
      });

      throw normalized;
    }
  }

  private async skipCalls(state: AgentLoopState, calls: AgentRuntimeToolCall[], message: string): Promise<void> {
    if (!calls.length) return;
    // A model request is preserved even when Runtime declines dispatch. This is not tool evidence.
    for (const call of calls) state.messages.push(this.observations.message(call, {
      status: 'failed', errorCode: 'TOOL_NOT_EXECUTED', message, retryable: false,
    }));
    await this.turns.journal(state.request.traceId, 'tools.skipped', state.iteration, { toolCalls: calls, reason: message });
  }

  private async consumeInputs(state: AgentLoopState): Promise<void> {
    const inputs = await this.turns.pendingInputs(state.request.traceId);
    if (!inputs.length) return;
    if (state.pendingClarificationId && !inputs.some((row) => row.kind !== 'CONTEXT_INJECTION')) throw new Error('USER_RESPONSE_REQUIRED');
    if (state.pendingClarificationId) {
      // This is a response to the actual pending request, never a fabricated tool execution.
      state.messages.push({ role: 'tool', name: CLARIFICATION_TOOL, toolCallId: state.pendingClarificationId,
        content: JSON.stringify({ userInputIds: inputs.filter((row) => row.kind !== 'CONTEXT_INJECTION').map((row) => row.id), status: 'user_responded' }) });
      state.pendingClarificationId = null;
    }

    const currentInputObjects: typeof state.currentInputObjects = [];
    let consumedUserInput = false;
    for (const input of inputs) {
      const refs = Array.isArray(input.objectRefs)
        ? input.objectRefs.flatMap((value, index) => {
            const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
            const objectId = String(row.objectId ?? '').trim();
            const rawPosition = Number(row.position);
            return objectId ? [{ objectId, position: Number.isInteger(rawPosition) && rawPosition >= 0 ? rawPosition : index }] : [];
          })
        : [];

      if (input.kind === 'CONTEXT_INJECTION') {
        state.messages.push({ id: input.id, role: 'system', content: refs.length
          ? { runtimeContextType: 'context_injection', text: input.content, objectRefs: refs }
          : input.content });
        continue;
      }

      consumedUserInput = true;
      const resolved = await this.turns.resolveInputObjects(state.request.traceId, refs);
      const objects = resolved.flatMap(({ ref, object }) => object
        ? [projectAgentObject(object, {
            role: 'user_input',
            messageId: state.request.userMessageId,
            inputId: input.id,
            inputKind: input.kind === 'USER_RESPONSE' ? 'USER_RESPONSE' : 'STEERING',
            position: ref.position,
          })]
        : []);
      const unavailableObjectIds = resolved.filter(({ object }) => !object).map(({ ref }) => ref.objectId);
      currentInputObjects.push(...objects);
      for (const object of objects) state.branchObjectIds.add(object.objectId);
      state.messages.push({
        id: input.id,
        role: 'user',
        content: unavailableObjectIds.length
          ? {
              runtimeContextType: 'user_input',
              text: input.content,
              attachedObjects: objects,
              unavailableObjectRefs: unavailableObjectIds.map((objectId) => ({ objectId, status: 'unknown' })),
            }
          : userInputContent(input.content, objects),
      });
    }
    if (consumedUserInput) state.currentInputObjects = currentInputObjects;
    await this.turns.checkpoint(state.request.traceId, state.snapshot('ready'), inputs.map((row) => row.id));
  }

  private async callModel(
    request: AgentRuntimeTurnRequest,
    state: AgentLoopState,
    hooks: AgentRuntimeHooks,
    allowTools: boolean,
  ): Promise<ModelGenerationResult> {

    const world = await this.world.resolve({ ...request, branchObjectIds: [...state.branchObjectIds] }, state.toolExecutions);
    state.authorizedTools = await this.tools.authorizedSurface(request);
    const authorized = [...state.authorizedTools, clarificationDefinition(), ...(state.authorizedTools.length ? [capabilitySearchDefinition()] : [])];
    const resolved = this.capabilities.resolve({ goal: request.input + '\n' + state.messages.filter((m) => m.role === 'user').slice(-3).map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n'), world,
      currentInputObjects: state.currentInputObjects, authorizedTools: authorized, loadedNames: state.loadedToolNames });
    state.selectedToolNames = new Set(resolved.tools.map((tool) => tool.name));
    const obligations = assessMutationEvidence(state.toolExecutions).unresolved;
    const context = this.context.resolve({ obligations, request, messages: state.messages, world,
      tools: allowTools ? resolved.tools : [], retry: state.contextRetries, capabilityCatalog: resolved.catalog });
    if (state.worldRevision !== world.revision) {
      await this.turns.journal(request.traceId, 'world.observed', state.iteration, world);
      state.worldRevision = world.revision;
    }
    for (const message of context.messages) {
      const block = message.content;
      if (block && !Array.isArray(block) && typeof block === 'object' && block.runtimeContextType === 'relevant_memory' && Array.isArray(block.usedMemoryIds)) {
        block.usedMemoryIds.filter((id) => typeof id === 'string').forEach((id) => state.usedMemoryIds.add(id));
      }
    }
    await this.turns.journal(request.traceId, 'context.resolved' , state.iteration, {
      selectedIndices: context.selectedIndices, inputIds: state.messages.filter((m, i) => context.selectedIndices.includes(i) && m.role === 'user').map((m) => m.id).filter(Boolean),
      beforeTokens: context.beforeTokens, afterTokens: context.afterTokens, limit: context.limit,
      toolNames: allowTools ? resolved.tools.map((tool) => tool.name) : [],
      usedMemoryIds: [...state.usedMemoryIds],
      authorizedToolCount: authorized.length,
    });
    return this.models.generate({
      traceId: request.traceId,
      conversationId: request.conversationId,
      assistantMessageId:
        request.assistantMessageId,
      iteration: state.iteration,
      route: {
        provider: request.agent.provider,
        model: request.agent.model,
        baseUrl: request.agent.baseUrl,
        apiKey: request.agent.apiKey,
        apiMode: request.agent.apiMode,
        protocol: request.agent.protocol,
        capabilities: request.agent.capabilities,
        headers: request.agent.headers,
      },
      fallbacks: request.agent.fallbacks,
      messages: context.messages,
      tools: allowTools ? resolved.tools : [],
      temperature: request.agent.temperature,
      maxTokens: request.agent.maxTokens,
      reasoningEffort:
        request.agent.reasoningEffort,
      signal: hooks.signal,
      firstTokenTimeoutMs: request.timeouts.firstToken * 1000,
      idleTimeoutMs: request.timeouts.idle * 1000,
      totalTimeoutMs: request.timeouts.modelTotal * 1000,
      onContentDelta: async (delta) => {
        if (!delta) {
          return;
        }

        if (allowTools) {
          state.appendIterationContent(delta);
          return;
        }

        if (state.contentMode === 'stream') {
          state.appendVisible(delta);

          await hooks.onContentDelta?.(delta);

          await this.emit(request, hooks, {
            type: 'content.delta',
            content: delta,
          });
        }
      },
      onReasoningDelta: async (delta) => {
        if (!delta) {
          return;
        }

        await this.emit(request, hooks, {
          type: 'reasoning.delta',
          content: delta,
        });
      },
      onLifecycle: async (update) => {
        if (['attempt.started', 'request.completed', 'attempt.retrying', 'route.fallback'].includes(update.stage)) {
          const detail = update.detail ?? {};
          await this.turns.journal(request.traceId, `model.${update.stage}`, state.iteration, {
            provider: detail.provider, model: detail.model, attempt: detail.attempt, routeIndex: detail.routeIndex, durationMs: detail.durationMs,
          });
        }
        await this.emit(request, hooks, {
          type: 'status',
          content: update.message,
          detail: {
            stage: update.stage,
            iteration: state.iteration,
            ...(update.detail ?? {}),
          },
        });
      },
    });
  }

  private async executeTools(
    request: AgentRuntimeTurnRequest,
    state: AgentLoopState,
    calls: AgentRuntimeToolCall[],
    hooks: AgentRuntimeHooks,
  ): Promise<AgentToolExecutionRecord[]> {
    const records: AgentToolExecutionRecord[] = [];
    const executable: AgentRuntimeToolCall[] = [];

    for (const call of calls) {
      if (!state.selectedToolNames.has(call.name)) {
        const now = Date.now();
        records.push({ call, startedAt: now, finishedAt: now, durationMs: 0, fingerprint: hash(stableStringify(call)),
          result: { status: 'failed', errorCode: 'TOOL_NOT_EXPOSED', message: 'Search available capabilities before calling this tool.', retryable: false } });
        continue;
      }
      if (call.name === CAPABILITY_SEARCH) {
        const now = Date.now();
        const found = this.capabilities.search(String(call.arguments.query ?? ''), state.authorizedTools);
        for (const tool of found) state.loadedToolNames.add(tool.name);
        while (state.loadedToolNames.size > 32) state.loadedToolNames.delete(state.loadedToolNames.values().next().value!);
        records.push({ call, startedAt: now, finishedAt: Date.now(), durationMs: Date.now() - now,
          fingerprint: hash(stableStringify(call)), result: { status: 'completed', observation: JSON.stringify({ tools: found, loadedForNextStep: true }) } });
        continue;
      }
      const fingerprint = hash(
        `${call.name}:${stableStringify(
          call.arguments,
        )}`,
      );

      const count =
        (
          state.toolFingerprintCounts.get(
            `call:${fingerprint}`,
          ) ?? 0
        ) + 1;

      state.toolFingerprintCounts.set(
        `call:${fingerprint}`,
        count,
      );

      if (count > 2) {
        const result: AgentToolResult = {
          status: 'failed',
          errorCode: 'REPEATED_TOOL_CALL',
          message:
            'This identical tool call has already been attempted twice without sufficient new progress. Select a different action.',
          retryable: false,
        };

        const now = Date.now();

        const record: AgentToolExecutionRecord = {
          call,
          result,
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
          fingerprint: hash(
            `${fingerprint}:${stableStringify(
              result,
            )}`,
          ),
        };

        records.push(record);

        await this.emit(request, hooks, {
          type: 'tool.failed',
          call,
          result,
        });
      } else {
        executable.push(call);
      }
    }

    if (executable.length) {
      records.push(
        ...(await this.tools.execute({
          request: { ...request, tools: state.authorizedTools, branchObjectIds: [...state.branchObjectIds] },
          calls: executable,
          iteration: state.iteration,
          signal: hooks.signal,
          emit: (event) =>
            this.emitRaw(hooks, event),
        })),
      );
    }

    return records;
  }

  private finishMessage(
    result: AgentToolResult,
  ): string {
    return result.status === 'completed'
      ? result.completionText ?? ''
      : '';
  }

  private async result(
    state: AgentLoopState,
    status:
      | 'succeeded'
      | 'partial'
      | 'failed'
      | 'cancelled',
    startedAt: number,
  ): Promise<AgentRuntimeRunResult> {
    const sealed = await this.turns.sealInputs(state.request.traceId);
    if (!sealed) {
      state.reasonCodes.push('agent:unconsumed_input_at_runtime_limit');
      if (status === 'succeeded') status = 'partial';
    }
    const assessment = assessMutationEvidence(state.toolExecutions);
    if (status === 'succeeded' && (assessment.unverifiedMutationCount || assessment.unknownOutcomeCount)) {
      status = 'partial';
      state.reasonCodes.push('agent:outcome_requires_evidence');
    }
    const content =
      state.visibleContent ||
      state.finalContent;

    const finishedAt = Date.now();
    const timing = {
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
    };

    await this.turns.journal(state.request.traceId, 'completion.decided', state.iteration, { status, assessment, reasonCodes: state.reasonCodes, budget: state.budget.snapshot() });
    await this.turns.checkpoint(state.request.traceId, state.snapshot('terminal'));
    const delivery = this.delivery.collect(
      state.toolExecutions,
      content,
    );

    const outcome = {
      kind: 'terminal' as const,
      status,
      reasonCodes: unique(
        state.reasonCodes,
      ),
      warnings: unique(state.warnings),
    };

    return {
      content,
      metadata: {
        usedMemoryIds: [...state.usedMemoryIds],
        completionEvidence: assessMutationEvidence(state.toolExecutions),
        engine: 'seekmore-agent-runtime-ts',
        budget: state.budget.snapshot(),
        iterations: state.iteration,
        toolCallCount:
          state.toolExecutions.length,
        usage: state.usage,
        reasoningChars:
          state.reasoning.length,
        timing,
      },
      warnings: outcome.warnings,
      reasonCodes: outcome.reasonCodes,
      outcome,
      usage: state.usage,
      iterations: state.iteration,
      toolCallCount:
        state.toolExecutions.length,
      citations: delivery.citations,
      observedCitationCount:
        delivery.observedCitationCount,
      objects: delivery.objects,
      toolExecutions:
        delivery.toolExecutions,
    };
  }

  private pausedResult(
    state: AgentLoopState,
    question: string,
    startedAt: number,
  ): AgentRuntimeRunResult {
    const delivery = this.delivery.collect(
      state.toolExecutions,
      state.visibleContent || question,
    );

    const finishedAt = Date.now();
    const timing = {
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
    };

    return {
      content:
        state.visibleContent || question,
      metadata: {
        usedMemoryIds: [...state.usedMemoryIds],
        completionEvidence: assessMutationEvidence(state.toolExecutions),
        engine: 'seekmore-agent-runtime-ts',
        budget: state.budget.snapshot(),
        iterations: state.iteration,
        toolCallCount:
          state.toolExecutions.length,
        usage: state.usage,
        timing,
      },
      warnings: unique(state.warnings),
      reasonCodes: unique(
        state.reasonCodes,
      ),
      outcome: {
        kind: 'paused',
        reason: 'user_input',
        reasonCodes: unique(
          state.reasonCodes,
        ),
        warnings: unique(state.warnings),
      },
      usage: state.usage,
      iterations: state.iteration,
      toolCallCount:
        state.toolExecutions.length,
      citations: delivery.citations,
      observedCitationCount:
        delivery.observedCitationCount,
      objects: delivery.objects,
      toolExecutions:
        delivery.toolExecutions,
    };
  }

  private assertActive(
    signal: AbortSignal | undefined,
  ): void {
    if (signal?.aborted) {
      throw new AgentRuntimeError(
        'AGENT_CANCELLED',
        'Agent turn was cancelled',
        false,
      );
    }
  }

  private emit(
    request: AgentRuntimeTurnRequest,
    hooks: AgentRuntimeHooks,
    event: EventWithoutBase,
  ): Promise<void> {
    return this.emitRaw(hooks, {
      ...event,
      traceId: request.traceId,
      conversationId: request.conversationId,
      userMessageId: request.userMessageId,
      assistantMessageId:
        request.assistantMessageId,
      timestamp: Date.now(),
    } as AgentRuntimeEvent);
  }

  private async emitRaw(
    hooks: AgentRuntimeHooks,
    event: AgentRuntimeEvent,
  ): Promise<void> {
    await hooks.onEvent?.(event);
  }
}

type EventWithoutBase =
  AgentRuntimeEvent extends infer Event
    ? Event extends AgentRuntimeEvent
      ? Omit<
          Event,
          | 'traceId'
          | 'conversationId'
          | 'userMessageId'
          | 'assistantMessageId'
          | 'timestamp'
        >
      : never
    : never;

function clarificationDefinition() {
  return {
    name: CLARIFICATION_TOOL,
    description:
      'Pause the current turn and ask the user one necessary clarification question only when the task cannot be completed safely or correctly without missing information.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['question'],
      properties: {
        question: {
          type: 'string',
          description:
            'The concise clarification question shown to the user.',
        },
        reason: {
          type: 'string',
          description:
            'Why the missing information is necessary.',
        },
      },
    },
  };
}

function unique(values: string[]): string[] {
  return [
    ...new Set(values.filter(Boolean)),
  ];
}
