import type { AgentPermissionMode } from '../../seekmore-agent/contracts/agent-turn.types';

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
  | 'RESOURCE_CONFLICT';

export type WorkflowContinuationMode = 'MANUAL' | 'AUTO';

export interface WorkflowContract {
  constraints: string[];
  expectedDeliverables: string[];
  metadata: Record<string, unknown>;
}

export interface WorkflowRunSnapshot {
  id: string;
  userId: string;
  agentId: string;
  conversationId: string;
  branchId: string | null;
  workspaceId: string | null;
  initialUserMessageId: string;
  inputObjectIds: string[];
  title: string;
  goal: string;
  contract: WorkflowContract;
  status: WorkflowRunStatus;
  waitReason: WorkflowWaitReason | null;
  continuationMode: WorkflowContinuationMode;
  permissionMode: AgentPermissionMode;
  currentPhaseId: string | null;
  version: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  fencingToken: bigint;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
}
