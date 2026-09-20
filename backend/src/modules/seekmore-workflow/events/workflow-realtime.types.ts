import type { WorkflowPhaseSnapshot } from '../contracts/workflow-phase.types';
import type { WorkflowContinuationMode, WorkflowRunSnapshot } from '../contracts/workflow-run.types';

export type WorkflowRealtimeReason =
  | 'created'
  | 'phase_changed'
  | 'state_changed'
  | 'continuation_changed'
  | 'completed'
  | 'cancelled'
  | 'deleted';

export interface WorkflowRealtimePhase {
  id: string;
  parentPhaseId: string | null;
  title: string;
  description: string | null;
  status: WorkflowPhaseSnapshot['status'];
  position: number;
  dependencyIds: string[];
  resultSummary: string | null;
}

export interface WorkflowRealtimeRun {
  id: string;
  conversationId: string;
  workspaceId: string | null;
  title: string;
  goal: string;
  status: WorkflowRunSnapshot['status'];
  waitReason: WorkflowRunSnapshot['waitReason'];
  continuationMode: WorkflowContinuationMode;
  currentPhaseId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRealtimeEvent {
  type: 'workflow:changed';
  eventId: string;
  reason: WorkflowRealtimeReason;
  userId: string;
  agentId: string;
  conversationId: string;
  workflowId: string;
  traceId: string | null;
  status: WorkflowRunSnapshot['status'];
  waitReason: WorkflowRunSnapshot['waitReason'];
  continuationMode: WorkflowRunSnapshot['continuationMode'];
  runVersion: number;
  updatedAt: string;
  phaseCount: number;
  phases: WorkflowRealtimePhase[];
  currentPhase: WorkflowRealtimePhase | null;
  run: WorkflowRealtimeRun;
  createdAt: number;
}
