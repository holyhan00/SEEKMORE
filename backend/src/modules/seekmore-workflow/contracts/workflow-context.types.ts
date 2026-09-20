import type { WorkflowContinuationMode, WorkflowRunStatus, WorkflowWaitReason } from './workflow-run.types';
import type { WorkflowPhaseStatus } from './workflow-phase.types';

export interface WorkflowTurnContext {
  active: true;
  workflow: {
    id: string;
    title: string;
    goal: string;
    status: WorkflowRunStatus;
    waitReason: WorkflowWaitReason | null;
    continuationMode: WorkflowContinuationMode;
    constraints: string[];
    expectedDeliverables: string[];
  };
  currentPhase: {
    id: string;
    title: string;
    description: string | null;
    status: WorkflowPhaseStatus;
    acceptanceCriteria: unknown | null;
  } | null;
  completedPhaseSummaries: Array<{
    id: string;
    title: string;
    summary: string | null;
  }>;
  nearbyPhases: Array<{
    id: string;
    title: string;
    status: WorkflowPhaseStatus;
  }>;
  protocol: {
    requiredClosure: boolean;
    closureActions: Array<'workflow.update' | 'workflow.complete' | 'workflow.block' | 'workflow.control'>;
    checkpointActions: Array<'workflow.update'>;
    terminalActions: Array<'workflow.complete' | 'workflow.block' | 'workflow.control'>;
    userTurnDirectContinuation: boolean;
    missingClosureState: 'WAITING';
  };
}
