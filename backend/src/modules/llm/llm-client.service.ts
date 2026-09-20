                                                
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LLMRegistryPort,
  LLMRegistryToken,
} from './llm-registry.port';
import { LlmProviderClientService } from './provider/llm-provider-client.service';
import type {
  LLMChatMessage,
  LLMNativeToolDecision,
  LLMNativeToolDefinition,
  StreamParams,
} from './llm-client.types';

export type {
  LLMChatMessage,
  LLMChatMessageRole,
  LLMNativeToolCall,
  LLMNativeToolDecision,
  LLMNativeToolDefinition,
  StreamCallbacks,
  StreamParams,
} from './llm-client.types';

@Injectable()
export class LLMClientService {
  private readonly logger = new Logger(LLMClientService.name);

  constructor(
    @Inject(LLMRegistryToken) private readonly registry: LLMRegistryPort,
    private readonly providerClient: LlmProviderClientService,
  ) {}

  async stream(params: StreamParams): Promise<void> {
    this.assertMessageInput(params.messages, params.userMessage);
    this.logger.log(
      `[LLM] stream start req=${params.requestId} agent=${params.agentId ?? '-'} model=${params.modelId ?? '-'} messageCount=${params.messages?.length ?? 1} msgLen=${this.messageChars(params.messages, params.userMessage)}`,
    );

    try {
      const config = await this.registry.resolve({
        userId: params.userId,
        agentId: params.agentId ?? null,
        modelId: params.modelId ?? null,
        override: {
          systemPrompt: params.systemPrompt,
          temperature: params.temperature,
          top_p: params.top_p,
          thinking: params.thinking,
        },
      });

      if (!config.apiKey) {
        this.safeError(params, 'NO_API_KEY', 'LLM API key is missing.');
        return;
      }

      this.logger.log(
        `[LLM] resolved provider=${config.providerKey ?? config.provider} protocol=${config.apiMode ?? 'chat_completions'} model=${config.model} req=${params.requestId}`,
      );

      await this.providerClient.stream({
        config,
        messages: this.messages(params.messages, params.userMessage),
        signal: params.controller.signal,
        onDelta: (chunk) => {
          if (!chunk || params.controller.signal.aborted) return;
          try { params.callbacks.onDelta(chunk); } catch {}
        },
      });

      if (params.controller.signal.aborted) {
        this.safeError(params, 'ABORTED', 'Request was cancelled.');
        return;
      }

      try { params.callbacks.onDone({ appendCard: null }); } catch {}
      this.logger.log(`[LLM] stream done req=${params.requestId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'Streaming error');
      const aborted = params.controller.signal.aborted || message === 'ABORTED' || message === 'aborted' || message === 'canceled';
      const code = aborted ? 'ABORTED' : message === 'NO_API_KEY' ? 'NO_API_KEY' : 'STREAM_ERROR';
      this.safeError(params, code, aborted ? 'Request was cancelled.' : message);

      if (aborted) {
        const cancellation = this.readCancellationReason(params.controller.signal.reason);
        this.logger.warn(
          `[LLM] stream canceled req=${params.requestId} cause=${cancellation?.cause ?? 'unknown'} timeoutMs=${cancellation?.timeoutMs ?? '-'}`,
        );
        return;
      }

      this.logger.error(`[LLM] stream error req=${params.requestId} ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async chat(args: {
    userId: string;
                                                                                       
    content?: string;
                                                                                                             
    messages?: LLMChatMessage[];
    agentId?: string;
    modelId?: string;
    systemPrompt?: string;
    temperature?: number;
    top_p?: number;
    thinking?: import('./llm-registry.port').LLMThinkingConfig;
    abortSignal?: AbortSignal;
  }): Promise<string> {
    this.assertMessageInput(args.messages, args.content);
    const config = await this.registry.resolve({
      userId: args.userId,
      agentId: args.agentId ?? null,
      modelId: args.modelId ?? null,
      override: {
        systemPrompt: args.systemPrompt,
        temperature: args.temperature,
        top_p: args.top_p,
        thinking: args.thinking,
      },
    });
    if (!config.apiKey) throw new Error('NO_API_KEY');

    this.logger.log(
      `[LLM] chat provider=${config.providerKey ?? config.provider} protocol=${config.apiMode ?? 'chat_completions'} model=${config.model} messageCount=${args.messages?.length ?? 1}`,
    );
    return this.providerClient.chat({
      config,
      messages: this.messages(args.messages, args.content),
      signal: args.abortSignal,
    });
  }

  async chatWithTools(args: {
    userId: string;
                                                                             
    content?: string;
                                                                                       
    messages?: LLMChatMessage[];
    tools: LLMNativeToolDefinition[];
    agentId?: string;
    modelId?: string;
    systemPrompt?: string;
    temperature?: number;
    top_p?: number;
    abortSignal?: AbortSignal;
  }): Promise<LLMNativeToolDecision> {
    this.assertMessageInput(args.messages, args.content);
    const config = await this.registry.resolve({
      userId: args.userId,
      agentId: args.agentId ?? null,
      modelId: args.modelId ?? null,
      override: {
        systemPrompt: args.systemPrompt,
        temperature: args.temperature ?? 0,
        top_p: args.top_p,
        thinking: { enabled: false, type: 'disabled' },
      },
    });
    if (!config.apiKey) throw new Error('NO_API_KEY');
    if (config.supportsTools === false) throw new Error('LLM_MODEL_NOT_AGENT_COMPATIBLE');

    this.logger.log(
      `[LLM] tools provider=${config.providerKey ?? config.provider} protocol=${config.apiMode ?? 'chat_completions'} model=${config.model} toolCount=${args.tools.length}`,
    );
    return this.providerClient.chatWithTools({
      config,
      messages: this.messages(args.messages, args.content),
      tools: args.tools,
      signal: args.abortSignal,
    });
  }

  private messages(messages: LLMChatMessage[] | undefined, content: string | undefined): LLMChatMessage[] {
    if (Array.isArray(messages) && messages.length > 0) {
      return messages.map((message) => ({ ...message, content: String(message.content ?? '') }));
    }
    return [{ role: 'user', content: String(content ?? '') }];
  }

  private assertMessageInput(messages: LLMChatMessage[] | undefined, content: string | undefined): void {
    if (Array.isArray(messages) && messages.length > 0) return;
    if (String(content ?? '').trim()) return;
    throw new Error('LLM_MESSAGES_EMPTY');
  }

  private messageChars(messages: LLMChatMessage[] | undefined, content: string | undefined): number {
    if (Array.isArray(messages)) {
      return messages.reduce((sum, message) => sum + String(message.content ?? '').length, 0);
    }
    return String(content ?? '').length;
  }

  private safeError(params: StreamParams, code: string, message: string): void {
    try { params.callbacks.onError({ code, message }); } catch {}
  }

  private readCancellationReason(value: unknown): { cause: 'timeout' | 'parent_abort'; timeoutMs: number | null } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as { cause?: unknown; timeoutMs?: unknown };
    if (candidate.cause !== 'timeout' && candidate.cause !== 'parent_abort') return null;
    const timeoutMs = Number(candidate.timeoutMs);
    return {
      cause: candidate.cause,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : null,
    };
  }
}
