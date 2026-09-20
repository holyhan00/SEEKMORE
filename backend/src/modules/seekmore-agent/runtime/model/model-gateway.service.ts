// backend/src/modules/seekmore-agent/runtime/model/model-gateway.service.ts
import { Injectable } from '@nestjs/common';
import { RuntimeFlowTraceLogger } from '../../../../common/trace/runtime-flow-trace.logger';
import type { AgentModelRoute } from '../../contracts/agent-turn.types';
import {
  AgentRuntimeError,
  ContextWindowExceededError,
  ModelProviderError,
} from '../errors/agent-runtime.errors';
import { sleep } from '../util/runtime.util';
import { AnthropicMessagesAdapter } from './adapters/anthropic-messages.adapter';
import { GeminiGenerateContentAdapter } from './adapters/gemini-generate-content.adapter';
import { OpenAiChatCompletionsAdapter } from './adapters/openai-chat-completions.adapter';
import { OpenAiResponsesAdapter } from './adapters/openai-responses.adapter';
import type {
  ModelGenerationRequest,
  ModelGenerationResult,
  ModelLifecycleUpdate,
  ModelProviderAdapter,
} from './model.types';
import { ModelRetryPolicyService } from './model-retry-policy.service';
import { ModelVisibleContentSanitizer } from './stream/model-visible-content-sanitizer';
import {
  downgradeToolProtocolHistory,
  repairToolMessageSequence,
} from './tool-message-sequence';
import { isToolProtocolSequenceError } from './model-http.util';
import { normalizeToolCallArguments } from './tool-call-argument-normalizer';

@Injectable()
export class ModelGatewayService {
  private readonly adapters: ModelProviderAdapter[];

  constructor(
    openAiChat: OpenAiChatCompletionsAdapter,
    openAiResponses: OpenAiResponsesAdapter,
    anthropic: AnthropicMessagesAdapter,
    gemini: GeminiGenerateContentAdapter,
    private readonly retries: ModelRetryPolicyService,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {
    this.adapters = [
      openAiResponses,
      anthropic,
      gemini,
      openAiChat,
    ];
  }

  async generate(
    input: ModelGenerationRequest & {
      fallbacks?: AgentModelRoute[];
    },
  ): Promise<ModelGenerationResult> {
    const startedAt = Date.now();
    const protocol = repairToolMessageSequence(input.messages);

    if (protocol.repaired) {
      this.trace.warn('agent_model.tool_protocol_repaired', {
        trace: input.traceId ?? null,
        conversationId: input.conversationId ?? null,
        assistantMessageId: input.assistantMessageId ?? null,
        iteration: input.iteration ?? null,
        beforeMessageCount: input.messages.length,
        afterMessageCount: protocol.messages.length,
        orphanToolMessages: protocol.orphanToolMessages,
        incompleteToolCallGroups: protocol.incompleteToolCallGroups,
        duplicateToolResponses: protocol.duplicateToolResponses,
        unmatchedToolResponses: protocol.unmatchedToolResponses,
      });
    }

    const routes = dedupeRoutes([
      input.route,
      ...(input.fallbacks ?? []),
    ]);
    const failures: Array<{
      route: AgentModelRoute;
      code: string;
      message: string;
    }> = [];

    this.trace.event('agent_model.generate_start', {
      trace: input.traceId ?? null,
      conversationId: input.conversationId ?? null,
      assistantMessageId: input.assistantMessageId ?? null,
      iteration: input.iteration ?? null,
      routeCount: routes.length,
      messageCount: protocol.messages.length,
      toolCount: input.tools.length,
      firstTokenTimeoutMs: input.firstTokenTimeoutMs,
      idleTimeoutMs: input.idleTimeoutMs,
      totalTimeoutMs: input.totalTimeoutMs,
    });

    for (
      let routeIndex = 0;
      routeIndex < routes.length;
      routeIndex += 1
    ) {
      const route = routes[routeIndex];
      const adapter = this.adapters.find(
        (candidate) => candidate.supports(route),
      );

      if (!adapter) {
        failures.push({
          route,
          code: 'MODEL_ADAPTER_NOT_FOUND',
          message:
            `No model adapter for ${route.provider}/${route.apiMode ?? 'default'}`,
        });
        this.trace.warn('agent_model.adapter_missing', {
          trace: input.traceId ?? null,
          iteration: input.iteration ?? null,
          routeIndex,
          provider: route.provider,
          model: route.model,
          apiMode: route.apiMode,
        });
        continue;
      }

      await this.lifecycle(input, {
        stage: routeIndex === 0
          ? 'route.started'
          : 'route.fallback',
        message: routeIndex === 0
          ? `Connecting to ${route.provider} model…`
          : `Primary model is unavailable. Switching to fallback ${route.provider}/${route.model}…`,
        detail: {
          routeIndex,
          provider: route.provider,
          model: route.model,
          apiMode: route.apiMode ?? null,
          adapter: adapter.kind,
        },
      });

      for (
        let attempt = 1;
        attempt <= this.retries.maximumAttempts();
        attempt += 1
      ) {
        if (input.signal?.aborted) {
          throw new ModelProviderError(
            'MODEL_CANCELLED',
            'Model request was cancelled',
            false,
          );
        }

        const attemptStartedAt = Date.now();
        let emitted = false;
        let firstDeltaLogged = false;
        const visibleContentSanitizer = new ModelVisibleContentSanitizer();

        this.trace.event('agent_model.attempt_start', {
          trace: input.traceId ?? null,
          conversationId: input.conversationId ?? null,
          assistantMessageId: input.assistantMessageId ?? null,
          iteration: input.iteration ?? null,
          routeIndex,
          attempt,
          provider: route.provider,
          model: route.model,
          apiMode: route.apiMode,
          adapter: adapter.kind,
        });

        await this.lifecycle(input, {
          stage: 'attempt.started',
          message: attempt === 1
            ? 'Model connection established. Waiting for the first response…'
            : `Starting model request attempt ${attempt}…`,
          detail: {
            routeIndex,
            attempt,
            provider: route.provider,
            model: route.model,
            adapter: adapter.kind,
          },
        });

        const onFirstDelta = async (
          kind: 'content' | 'reasoning',
          delta: string,
        ) => {
          if (delta) emitted = true;
          if (!delta || firstDeltaLogged) return;
          firstDeltaLogged = true;

          this.trace.event('agent_model.first_delta', {
            trace: input.traceId ?? null,
            conversationId: input.conversationId ?? null,
            assistantMessageId: input.assistantMessageId ?? null,
            iteration: input.iteration ?? null,
            routeIndex,
            attempt,
            provider: route.provider,
            model: route.model,
            kind,
            deltaLen: delta.length,
            latencyMs: Date.now() - attemptStartedAt,
          });

          await this.lifecycle(input, {
            stage: 'stream.first_delta',
            message: kind === 'reasoning'
              ? 'Model reasoning has started…'
              : 'Model output generation has started…',
            detail: {
              routeIndex,
              attempt,
              provider: route.provider,
              model: route.model,
              kind,
              latencyMs: Date.now() - attemptStartedAt,
            },
          });
        };

        try {
          const result = await this.generateWithToolProtocolRecovery({
            adapter,
            request: input,
            route,
            messages: protocol.messages,
            routeIndex,
            attempt,
            hasEmitted: () => emitted,
            onContentDelta: async (delta) => {
              const visibleDelta = visibleContentSanitizer.push(delta);
              if (!visibleDelta) return;
              await onFirstDelta('content', visibleDelta);
              await input.onContentDelta?.(visibleDelta);
            },
            onReasoningDelta: async (delta) => {
              await onFirstDelta('reasoning', delta);
              await input.onReasoningDelta?.(delta);
            },
          });

          const visibleTail = visibleContentSanitizer.flush();
          if (visibleTail) {
            await onFirstDelta('content', visibleTail);
            await input.onContentDelta?.(visibleTail);
          }

          const toolCallNormalization =
            normalizeToolCallArguments(
              result.toolCalls,
              input.tools,
            );

          for (const event of toolCallNormalization.events) {
            this.trace.event(
              'agent_model.tool_arguments_normalized',
              {
                trace: input.traceId ?? null,
                conversationId: input.conversationId ?? null,
                assistantMessageId: input.assistantMessageId ?? null,
                iteration: input.iteration ?? null,
                routeIndex,
                attempt,
                provider: route.provider,
                model: route.model,
                tool: event.tool,
                reason: event.reason,
                envelopeDepth: event.envelopeDepth,
                originalKeys: event.originalKeys.join(','),
                normalizedKeys: event.normalizedKeys.join(','),
              },
            );
          }

          const sanitizedResult: ModelGenerationResult = {
            ...result,
            content: visibleContentSanitizer.sanitizeComplete(result.content),
            toolCalls: toolCallNormalization.toolCalls,
          };

          this.trace.event('agent_model.attempt_done', {
            trace: input.traceId ?? null,
            conversationId: input.conversationId ?? null,
            assistantMessageId: input.assistantMessageId ?? null,
            iteration: input.iteration ?? null,
            routeIndex,
            attempt,
            provider: route.provider,
            model: route.model,
            adapter: adapter.kind,
            durationMs: Date.now() - attemptStartedAt,
            contentLen: sanitizedResult.content.length,
            reasoningLen: sanitizedResult.reasoning.length,
            toolCallCount: sanitizedResult.toolCalls.length,
            finishReason: sanitizedResult.finishReason,
          });

          await this.lifecycle(input, {
            stage: 'request.completed',
            message: sanitizedResult.toolCalls.length
              ? `Model selected ${sanitizedResult.toolCalls.length} tools. Entering execution…`
              : 'Model response completed. Preparing the result…',
            detail: {
              routeIndex,
              attempt,
              provider: route.provider,
              model: route.model,
              durationMs: Date.now() - attemptStartedAt,
              toolCallCount: sanitizedResult.toolCalls.length,
              finishReason: sanitizedResult.finishReason,
            },
          });

          return sanitizedResult;
        } catch (error) {
          if (error instanceof ContextWindowExceededError) {
            this.trace.warn('agent_model.context_rejected', {
              trace: input.traceId ?? null,
              iteration: input.iteration ?? null,
              routeIndex,
              attempt,
              provider: route.provider,
              model: route.model,
              durationMs: Date.now() - attemptStartedAt,
              error: error.message,
            });
            throw error;
          }

          const normalized = normalizeError(error);
          failures.push({
            route,
            code: normalized.code,
            message: normalized.message,
          });

          this.trace.warn('agent_model.attempt_failed', {
            trace: input.traceId ?? null,
            conversationId: input.conversationId ?? null,
            assistantMessageId: input.assistantMessageId ?? null,
            iteration: input.iteration ?? null,
            routeIndex,
            attempt,
            provider: route.provider,
            model: route.model,
            adapter: adapter.kind,
            durationMs: Date.now() - attemptStartedAt,
            emitted,
            errorCode: normalized.code,
            retryable: normalized.retryable,
            error: normalized.message,
          });

          if (emitted) {
            throw new ModelProviderError(
              'MODEL_STREAM_INTERRUPTED_AFTER_DELTA',
              normalized.message,
              false,
              {
                causeCode: normalized.code,
                route,
              },
            );
          }

          if (!this.retries.shouldRetry(normalized, attempt)) {
            break;
          }

          const delayMs = this.retries.delayMs(
            normalized,
            attempt,
          );

          await this.lifecycle(input, {
            stage: 'attempt.retrying',
            message:
              `Model request temporarily failed. Retrying in ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${this.retries.maximumAttempts()})…`,
            detail: {
              routeIndex,
              attempt,
              nextAttempt: attempt + 1,
              delayMs,
              provider: route.provider,
              model: route.model,
              errorCode: normalized.code,
            },
          });

          this.trace.event('agent_model.retry_wait', {
            trace: input.traceId ?? null,
            iteration: input.iteration ?? null,
            routeIndex,
            attempt,
            delayMs,
            provider: route.provider,
            model: route.model,
            errorCode: normalized.code,
          });

          await sleep(delayMs, input.signal);
        }
      }
    }

    const last = failures.at(-1);
    this.trace.error('agent_model.generate_failed', {
      trace: input.traceId ?? null,
      conversationId: input.conversationId ?? null,
      assistantMessageId: input.assistantMessageId ?? null,
      iteration: input.iteration ?? null,
      durationMs: Date.now() - startedAt,
      failureCount: failures.length,
      errorCode: last?.code ?? 'MODEL_ALL_ROUTES_FAILED',
      error: last?.message ?? 'Every configured model route failed',
    });

    throw new ModelProviderError(
      last?.code ?? 'MODEL_ALL_ROUTES_FAILED',
      last?.message
        ?? 'Every configured model route failed',
      false,
      { failures },
    );
  }

  private async generateWithToolProtocolRecovery(input: {
    adapter: ModelProviderAdapter;
    request: ModelGenerationRequest & { fallbacks?: AgentModelRoute[] };
    route: AgentModelRoute;
    messages: ModelGenerationRequest['messages'];
    routeIndex: number;
    attempt: number;
    hasEmitted: () => boolean;
    onContentDelta: NonNullable<ModelGenerationRequest['onContentDelta']>;
    onReasoningDelta: NonNullable<ModelGenerationRequest['onReasoningDelta']>;
  }): Promise<ModelGenerationResult> {
    const recoveryStartedAt = Date.now();

    const generate = (
      messages: ModelGenerationRequest['messages'],
      tools: ModelGenerationRequest['tools'],
    ) => input.adapter.generate({
      ...input.request,
      route: input.route,
      messages,
      tools,
      totalTimeoutMs: Math.max(
        1_000,
        input.request.totalTimeoutMs
          - (Date.now() - recoveryStartedAt),
      ),
      onContentDelta: input.onContentDelta,
      onReasoningDelta: input.onReasoningDelta,
    });

    try {
      return await generate(
        input.messages,
        input.request.tools,
      );
    } catch (error) {
      if (
        input.hasEmitted()
        || !isToolProtocolSequenceError(error)
      ) {
        throw error;
      }

      const strict = downgradeToolProtocolHistory(
        input.messages,
      );

      this.trace.warn(
        'agent_model.tool_protocol_http400_detected',
        {
          trace: input.request.traceId ?? null,
          conversationId:
            input.request.conversationId ?? null,
          assistantMessageId:
            input.request.assistantMessageId ?? null,
          iteration: input.request.iteration ?? null,
          routeIndex: input.routeIndex,
          attempt: input.attempt,
          provider: input.route.provider,
          model: input.route.model,
          recoveryLevel: 'history_downgrade',
          beforeMessageCount: input.messages.length,
          afterMessageCount: strict.messages.length,
          assistantToolCallMessages:
            strict.assistantToolCallMessages,
          toolMessages: strict.toolMessages,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );

      try {
        const recovered = await generate(
          strict.messages,
          input.request.tools,
        );

        this.trace.event(
          'agent_model.tool_protocol_recovery_succeeded',
          {
            trace: input.request.traceId ?? null,
            conversationId:
              input.request.conversationId ?? null,
            assistantMessageId:
              input.request.assistantMessageId ?? null,
            iteration: input.request.iteration ?? null,
            routeIndex: input.routeIndex,
            attempt: input.attempt,
            provider: input.route.provider,
            model: input.route.model,
            recoveryLevel: 'history_downgrade',
          },
        );

        return recovered;
      } catch (strictError) {
        if (
          input.hasEmitted()
          || !isToolProtocolSequenceError(strictError)
        ) {
          throw strictError;
        }

        const noToolMessages = [
          ...strict.messages,
          {
            role: 'system' as const,
            content: [
              'Historical tool protocol frames were unavailable for this model request.',
              'Continue from the preserved textual observations and user context.',
              'Do not claim that tools are globally unavailable; this fallback applies only to this model call.',
              'Return the best complete answer possible without issuing a tool call in this response.',
            ].join('\n'),
          },
        ];

        this.trace.warn(
          'agent_model.tool_protocol_no_tool_fallback',
          {
            trace: input.request.traceId ?? null,
            conversationId:
              input.request.conversationId ?? null,
            assistantMessageId:
              input.request.assistantMessageId ?? null,
            iteration: input.request.iteration ?? null,
            routeIndex: input.routeIndex,
            attempt: input.attempt,
            provider: input.route.provider,
            model: input.route.model,
            beforeToolCount: input.request.tools.length,
            messageCount: noToolMessages.length,
            error:
              strictError instanceof Error
                ? strictError.message
                : String(strictError),
          },
        );

        const recovered = await generate(
          noToolMessages,
          [],
        );

        this.trace.event(
          'agent_model.tool_protocol_recovery_succeeded',
          {
            trace: input.request.traceId ?? null,
            conversationId:
              input.request.conversationId ?? null,
            assistantMessageId:
              input.request.assistantMessageId ?? null,
            iteration: input.request.iteration ?? null,
            routeIndex: input.routeIndex,
            attempt: input.attempt,
            provider: input.route.provider,
            model: input.route.model,
            recoveryLevel: 'no_tool',
          },
        );

        return recovered;
      }
    }
  }

  private async lifecycle(
    input: ModelGenerationRequest,
    update: ModelLifecycleUpdate,
  ): Promise<void> {
    await input.onLifecycle?.(update);
  }
}

function normalizeError(error: unknown): AgentRuntimeError {
  if (error instanceof AgentRuntimeError) return error;
  return new ModelProviderError(
    'MODEL_UNKNOWN_ERROR',
    error instanceof Error
      ? error.message
      : String(error),
    true,
    error,
  );
}

function dedupeRoutes(
  routes: AgentModelRoute[],
): AgentModelRoute[] {
  const seen = new Set<string>();
  const output: AgentModelRoute[] = [];

  for (const route of routes) {
    const key = [
      route.provider,
      route.model,
      route.baseUrl ?? '',
      route.apiMode ?? '',
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    output.push(route);
  }

  return output;
}
