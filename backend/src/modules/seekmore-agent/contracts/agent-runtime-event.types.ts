import type { ToolPresentation } from '../../../tools/toolstypes';
import type { AgentRuntimeToolCall } from './agent-turn.types';
import type { AgentToolResult } from './agent-tool.types';

export interface AgentRuntimeTiming {
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
}

interface AgentRuntimeEventBase {
  traceId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  timestamp: number;
}

export type AgentRuntimeEvent =
  | (AgentRuntimeEventBase & { type: 'turn.started'; detail: Record<string, unknown> & { startedAt: number } })
  | (AgentRuntimeEventBase & { type: 'model.started'; detail: Record<string, unknown> })
  | (AgentRuntimeEventBase & { type: 'content.delta'; content: string })
  | (AgentRuntimeEventBase & { type: 'iteration.summary'; iteration: number; content: string })
  | (AgentRuntimeEventBase & { type: 'iteration.completed'; iteration: number; detail: { toolCallCount: number; failedCount: number; startedAt: number; finishedAt: number; durationMs: number } })
  | (AgentRuntimeEventBase & { type: 'reasoning.delta'; content: string })
  | (AgentRuntimeEventBase & { type: 'status'; content: string; detail?: Record<string, unknown> })
  | (AgentRuntimeEventBase & { type: 'tool.requested'; call: AgentRuntimeToolCall; presentation?: ToolPresentation })
  | (AgentRuntimeEventBase & { type: 'tool.started'; call: AgentRuntimeToolCall; presentation?: ToolPresentation })
  | (AgentRuntimeEventBase & { type: 'tool.completed'; call: AgentRuntimeToolCall; result: AgentToolResult; presentation?: ToolPresentation })
  | (AgentRuntimeEventBase & { type: 'tool.failed'; call: AgentRuntimeToolCall; result: AgentToolResult; presentation?: ToolPresentation })
  | (AgentRuntimeEventBase & { type: 'clarification'; content: string })
  | (AgentRuntimeEventBase & { type: 'verification.required'; detail: Record<string, unknown> })
  | (AgentRuntimeEventBase & { type: 'turn.paused'; reason: 'approval' | 'user_input' | 'external_dependency'; content: string; detail: Record<string, unknown> & { timing: AgentRuntimeTiming } })
  | (AgentRuntimeEventBase & { type: 'turn.completed'; content: string; detail: Record<string, unknown> & { timing: AgentRuntimeTiming } })
  | (AgentRuntimeEventBase & { type: 'turn.failed'; errorCode: string; message: string; detail: Record<string, unknown> & { timing?: AgentRuntimeTiming } });
