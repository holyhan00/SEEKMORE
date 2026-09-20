import type { AgentToolExecutionRecord } from '../contracts/agent-tool.types';
import type { ModelUsage } from '../runtime/model/model.types';
import type { WorldSnapshot } from '../runtime/context/world-state.types';
export interface ExperienceEvent { id: string; sequence: number; kind: string; iteration: number; payload: Record<string, any>; occurredAt: string }
export interface AgentExperienceEpisode {
  turnId: string; traceId: string; goal: string;
  goalRevisions: Array<{ inputId: string; content: string; kind: string }>;
  initialWorldState: WorldSnapshot | null;
  relevantWorldChanges: Array<{ eventId: string; revision: string }>;
  inputs: Array<{ id: string; kind: string; content: string; consumedAt: string | null }>;
  events: ExperienceEvent[];
  toolActions: AgentToolExecutionRecord[];
  outcome: { runtimeStatus: string; completionDecision: Record<string, unknown> | null };
  usage: ModelUsage | null;
  startedAt: string; completedAt: string | null;
  approvals?: Array<{ approvalId: string; status: string; decision: string | null; decidedAt: string | null }>;
  costs: null;
  userFeedback: null;
  availability: { journal: boolean; environmentEvaluator: boolean; feedback: boolean; cost: boolean };
}
