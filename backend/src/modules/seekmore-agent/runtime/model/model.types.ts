import type {
  AgentModelRoute,
  AgentRuntimeMessage,
  AgentRuntimeToolCall,
  AgentRuntimeToolDefinition,
} from '../../contracts/agent-turn.types';

export type ModelFinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'cancelled'
  | 'error'
  | 'unknown';

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

export interface ModelLifecycleUpdate {
  stage: 'route.started' | 'attempt.started' | 'stream.first_delta' | 'attempt.retrying' | 'route.fallback' | 'request.completed';
  message: string;
  detail?: Record<string, unknown>;
}

export interface ModelGenerationRequest {
  route: AgentModelRoute;
  traceId?: string;
  conversationId?: string;
  assistantMessageId?: string;
  iteration?: number;
  messages: AgentRuntimeMessage[];
  tools: AgentRuntimeToolDefinition[];
  temperature?: number | null;
  maxTokens?: number | null;
  reasoningEffort?: string | null;
  signal?: AbortSignal;
  firstTokenTimeoutMs: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  onContentDelta?: (delta: string) => Promise<void> | void;
  onReasoningDelta?: (delta: string) => Promise<void> | void;
  onLifecycle?: (update: ModelLifecycleUpdate) => Promise<void> | void;
}

export interface ModelGenerationResult {
  provider: string;
  model: string;
  content: string;
  reasoning: string;
  toolCalls: AgentRuntimeToolCall[];
  finishReason: ModelFinishReason;
  usage: ModelUsage;
  metadata: Record<string, unknown>;
}

export interface ModelProviderAdapter {
  readonly kind: string;
  supports(route: AgentModelRoute): boolean;
  generate(request: ModelGenerationRequest): Promise<ModelGenerationResult>;
}
