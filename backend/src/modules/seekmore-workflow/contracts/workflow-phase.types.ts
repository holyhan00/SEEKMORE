export type WorkflowPhaseStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export interface WorkflowPhaseDraft {
  ref: string;
  title: string;
  description?: string | null;
  parentRef?: string | null;
  dependencyRefs?: string[];
  acceptanceCriteria?: unknown;
}

export interface WorkflowPhaseCreateInput {
  id: string;
  workflowId: string;
  parentPhaseId: string | null;
  title: string;
  description: string | null;
  status: WorkflowPhaseStatus;
  position: number;
  dependencyIds: string[];
  acceptanceCriteria: unknown | null;
}

export interface WorkflowPhasePatch {
  phaseId: string;
  title?: string;
  description?: string | null;
  parentPhaseId?: string | null;
  dependencyIds?: string[];
  position?: number;
  acceptanceCriteria?: unknown | null;
}

export interface WorkflowPhaseSnapshot {
  id: string;
  workflowId: string;
  parentPhaseId: string | null;
  title: string;
  description: string | null;
  status: WorkflowPhaseStatus;
  position: number;
  dependencyIds: string[];
  acceptanceCriteria: unknown | null;
  resultSummary: string | null;
  result: unknown | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
