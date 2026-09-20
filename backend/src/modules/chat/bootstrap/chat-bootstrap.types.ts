import type { WorkflowPhaseSnapshot } from '../../seekmore-workflow/contracts/workflow-phase.types';
import type { WorkflowRunSnapshot } from '../../seekmore-workflow/contracts/workflow-run.types';
import type { RuntimeTimelineReplayEvent } from '../runtime-events/runtime-timeline-event.repository';
import type { ChatTurnQueueSnapshot } from '../turn/chat-turn-request.types';
import type { RuntimeConversationSettingsSnapshot } from '../../approval/runtime-access-policy.types';

export interface ActiveWorkflowSnapshot {
  run: WorkflowRunSnapshot;
  phases: WorkflowPhaseSnapshot[];
  currentPhase: WorkflowPhaseSnapshot | null;
}

export interface ChatBootstrapResponse {
  conversationId: string;
  messages: unknown[];
  runtimeTimeline: {
    events: RuntimeTimelineReplayEvent[];
    nextCursor: string | null;
  };
  workflow: ActiveWorkflowSnapshot | null;
  turn: ChatTurnQueueSnapshot | null;
  runtimeSettings: RuntimeConversationSettingsSnapshot;
  generatedAt: number;
}
