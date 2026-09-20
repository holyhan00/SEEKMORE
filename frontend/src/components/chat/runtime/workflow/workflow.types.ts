export type WorkflowRunStatus =
  | 'RUNNING'
  | 'WAITING'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type WorkflowWaitReason =
  | 'CONTINUATION'
  | 'USER_INPUT'
  | 'APPROVAL'
  | 'EXTERNAL_DEPENDENCY'
  | 'RESOURCE_CONFLICT'
  | null;

export type WorkflowPhaseStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export type WorkflowPhaseView = {
  id: string;
  workflowId?: string;
  parentPhaseId: string | null;
  title: string;
  description: string | null;
  status: WorkflowPhaseStatus;
  position: number;
  dependencyIds: string[];
  acceptanceCriteria?: unknown | null;
  resultSummary: string | null;
  result?: unknown | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkflowRunView = {
  id: string;
  conversationId: string;
  workspaceId: string | null;
  title: string;
  goal: string;
  status: WorkflowRunStatus;
  waitReason: WorkflowWaitReason;
  continuationMode: 'MANUAL' | 'AUTO';
  permissionMode?: 'confirm_required' | 'audit_autorun' | 'full_access';
  currentPhaseId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ActiveWorkflowSnapshot = {
  run: WorkflowRunView;
  phases: WorkflowPhaseView[];
  currentPhase: WorkflowPhaseView | null;
};

export type ActiveWorkflowLoadState = {
  scopeKey: string | null;
  status: 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';
  snapshot: ActiveWorkflowSnapshot | null;
  hydratedAt: number | null;
  lastWorkflowId: string | null;
  lastRunVersion: number | null;
  lastUpdatedAt: number | null;
  error: string | null;
};

export type WorkflowRealtimeReason =
  | 'created'
  | 'phase_changed'
  | 'state_changed'
  | 'continuation_changed'
  | 'completed'
  | 'cancelled'
  | 'deleted';

export type WorkflowRealtimeEvent = {
  type: 'workflow:changed';
  eventId: string;
  reason: WorkflowRealtimeReason;
  userId: string;
  agentId: string;
  conversationId: string;
  workflowId: string;
  traceId: string | null;
  status: WorkflowRunStatus;
  waitReason: WorkflowWaitReason;
  continuationMode: 'MANUAL' | 'AUTO';
  runVersion: number;
  updatedAt: string;
  phaseCount: number;
  phases: WorkflowPhaseView[];
  currentPhase: WorkflowPhaseView | null;
  run: WorkflowRunView;
  createdAt: number;
};
