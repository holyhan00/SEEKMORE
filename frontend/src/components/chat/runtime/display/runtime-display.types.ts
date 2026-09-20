import type {
  RuntimeActivity,
  RuntimeEvent,
  RuntimeExecutionTiming,
  RuntimeReasoningSummary,
  RuntimeStep,
  RuntimePresentation,
} from '../events/runtime-events.types';

export type AssistantTimelineItem =
  | AssistantExecutionGroup
  | AssistantTextSegment
  | AssistantActivitySegment;

export interface RuntimeDisplayReasoningSummary
  extends RuntimeReasoningSummary {
  sequence: number;
}

export interface AssistantExecutionGroup {
  segmentId: string;
  type: 'execution-group';
  sequence: number;
  step: RuntimeStep;
  summary: string;
  commentary: AssistantTextSegment[];
  reasoning: RuntimeDisplayReasoningSummary[];
  activities: RuntimeActivity[];
  timing: RuntimeExecutionTiming | null;
}

export interface AssistantTextSegment {
  segmentId: string;
  type: 'text';
  sequence: number;
  markdown: string;
  role: 'commentary' | 'final';
  final: boolean;
}

export interface AssistantActivitySegment {
  segmentId: string;
  type: 'activity';
  sequence: number;
  activity: RuntimeActivity;
}

export interface PendingRuntimeActivityView {
  sequence: number;
  title: string;
  presentation?: RuntimePresentation | null;
}

export interface RuntimeDisplayProjection {
  groupsById: Record<string, AssistantExecutionGroup>;
  groupIds: string[];
  surfacesById: Record<
    string,
    AssistantTextSegment | AssistantActivitySegment
  >;
  surfaceIds: string[];
  pendingByStepId: Record<string, RuntimeEvent[]>;
  unattached: RuntimeEvent[];
  items: AssistantTimelineItem[];
  pendingActivityById: Record<
    string,
    PendingRuntimeActivityView
  >;
  latestPendingActivityTitle: string | null;
  latestPendingActivity: PendingRuntimeActivityView | null;
}
