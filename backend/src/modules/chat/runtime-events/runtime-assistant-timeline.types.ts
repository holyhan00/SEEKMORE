export type RuntimePublicActivityKind =
  | 'phase' | 'tool' | 'observation' | 'verification' | 'approval'
  | 'clarification' | 'repair' | 'result';

export type RuntimePublicActivityStatus =
  | 'queued' | 'running' | 'waiting' | 'blocked' | 'succeeded'
  | 'failed' | 'partial' | 'cancelled' | 'skipped';

export type RuntimePublicStepKind = 'analysis' | 'execution' | 'verification' | 'recovery' | 'delivery';
export type RuntimePublicStepStatus = 'running' | 'waiting' | 'succeeded' | 'failed';

export interface RuntimePublicPresentation {
  key: string;
  params?: Record<string, string | number | boolean | null>;
}

export interface RuntimePublicActivityTarget {
  kind: string;
  label: string | null;
  resourceId: string | null;
}

export interface RuntimePublicActivity {
  activityId: string;
  assistantMessageId: string;
  conversationId: string;
  workflowId: string | null;
  stepId: string | null;
  parentActivityId: string | null;
  sequence: number;
  version: number;
  kind: RuntimePublicActivityKind;
  operation: string;
  target: RuntimePublicActivityTarget | null;
  status: RuntimePublicActivityStatus;
  title: string;
  presentation?: RuntimePublicPresentation | null;
  summary: string | null;
  summaryPresentation?: RuntimePublicPresentation | null;
  progress: { completed: number; total: number | null; unit: string | null } | null;
  evidenceRefs: string[];
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  detail: Record<string, unknown> | null;
}

export interface RuntimePublicExecutionTiming {
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
}

export interface RuntimePublicStep {
  stepId: string;
  parentStepId: string | null;
  kind: RuntimePublicStepKind;
  iteration: number | null;
  title: string | null;
  presentation?: RuntimePublicPresentation | null;
  status: RuntimePublicStepStatus;
  startedAt: number;
  finishedAt: number | null;
  timing?: RuntimePublicExecutionTiming | null;
}

export interface RuntimePublicReasoningSummary {
  summaryId: string;
  stepId: string;
  markdown: string;
  status: 'streaming' | 'completed';
}

export interface RuntimePublicTimelineBase {
  eventId: string;
  sequence: number;
  userId: string | null;
  conversationId: string;
  assistantMessageId: string;
  traceId: string | null;
  createdAt: number;
}

export interface RuntimePublicContentEvent extends RuntimePublicTimelineBase {
  type: 'assistant.timeline.content';
  block: { blockId: string; role: 'commentary' | 'final'; markdown: string; final: boolean; stepId?: string | null };
}
export interface RuntimePublicStepEvent extends RuntimePublicTimelineBase {
  type: 'assistant.timeline.step';
  step: RuntimePublicStep;
}
export interface RuntimePublicReasoningSummaryEvent extends RuntimePublicTimelineBase {
  type: 'assistant.timeline.reasoning_summary';
  summary: RuntimePublicReasoningSummary;
}
export interface RuntimePublicActivityEvent extends RuntimePublicTimelineBase {
  type: 'assistant.timeline.activity';
  activity: RuntimePublicActivity;
}
export type RuntimePublicTimelineEvent =
  | RuntimePublicContentEvent
  | RuntimePublicStepEvent
  | RuntimePublicReasoningSummaryEvent
  | RuntimePublicActivityEvent;
