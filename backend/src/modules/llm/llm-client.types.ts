import type { LLMThinkingConfig } from './llm-registry.port';

export type LLMChatMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type LLMChatMessage = {
  role: LLMChatMessageRole;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type LLMNativeToolDefinition = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export type LLMNativeToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LLMNativeToolDecision = {
  content: string;
  toolCalls: LLMNativeToolCall[];
  finishReason: string | null;
};

export type StreamCallbacks = {
  onDelta: (chunk: string) => void;
  onDone: (final: { appendCard?: string | null }) => void;
  onError: (err: { code: string; message: string }) => void;
};

export type StreamParams = {
  requestId: string;
  userId: string;
                                                                                     
  userMessage?: string;
                                                                                                                             
  messages?: LLMChatMessage[];
  controller: AbortController;
  callbacks: StreamCallbacks;
  agentId?: string;
  modelId?: string;
  systemPrompt?: string;
  temperature?: number;
  top_p?: number;
  thinking?: LLMThinkingConfig;
};
