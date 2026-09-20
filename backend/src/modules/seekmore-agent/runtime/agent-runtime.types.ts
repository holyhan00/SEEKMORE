import type { AgentTurnOutcome } from '../contracts/agent-turn.types';
import type { AgentRuntimeEvent, AgentRuntimeTiming } from '../contracts/agent-runtime-event.types';
import type { AgentToolExecutionSnapshot } from '../contracts/agent-tool.types';
import type { ModelUsage } from './model/model.types';


export interface AgentRuntimeHooks {
  signal?: AbortSignal;
  onContentDelta?(delta: string): Promise<void> | void;
  onEvent?(event: AgentRuntimeEvent): Promise<void> | void;
}

export interface AgentRuntimeRunResult {
  content: string;
  runtimePatch?: Record<string, unknown> | null;
  metadata: Record<string, unknown> & { timing: AgentRuntimeTiming };
  warnings: string[];
  reasonCodes: string[];
  outcome: AgentTurnOutcome;
  usage: ModelUsage;
  iterations: number;
  toolCallCount: number;
  citations: Array<Record<string, unknown>>;
  observedCitationCount: number;
  objects: Array<Record<string, unknown>>;
  toolExecutions: AgentToolExecutionSnapshot[];
}
