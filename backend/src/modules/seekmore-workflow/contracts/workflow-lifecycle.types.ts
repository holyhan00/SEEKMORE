import type { WorkflowContinuationMode } from './workflow-run.types';
import type { WorkflowPhaseDraft, WorkflowPhasePatch } from './workflow-phase.types';

export interface WorkflowStartInput {
  title: string;
  goal: string;
  continuationMode: WorkflowContinuationMode;
  phases: WorkflowPhaseDraft[];
  constraints?: string[];
  expectedDeliverables?: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkflowUpdateInput {
  progressSummary?: string;
  goal?: string;
  constraints?: string[];
  expectedDeliverables?: string[];
  completedPhases?: Array<{
    phaseId: string;
    summary: string;
    result?: unknown;
  }>;
  add?: WorkflowPhaseDraft[];
  update?: WorkflowPhasePatch[];
  skipPhaseIds?: string[];
  cancelPhaseIds?: string[];
  removePhaseIds?: string[];
  currentPhaseId?: string | null;
}

export interface WorkflowCompleteInput {
  summary: string;
  result?: unknown;
}

export interface WorkflowBlockInput {
  kind:
    | 'USER_INPUT'
    | 'EXTERNAL_DEPENDENCY'
    | 'RESOURCE_CONFLICT'
    | 'UNRECOVERABLE';
  reason: string;
}

export interface WorkflowControlInput {
  action: 'RESUME' | 'PAUSE' | 'CANCEL' | 'SET_CONTINUATION';
  continuationMode?: WorkflowContinuationMode;
  reason?: string;
}
