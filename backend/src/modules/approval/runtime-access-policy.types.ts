import type { AgentPermissionMode } from '../seekmore-agent/contracts/agent-turn.types';

export type RuntimeApprovalScopeType = 'TURN' | 'WORKFLOW';
export type RuntimeRiskLevel = 'low' | 'medium' | 'high' | 'forbidden';
export type RuntimeAccessDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';

export interface RuntimeTaskAccessScope {
  scopeType: RuntimeApprovalScopeType;
  scopeId: string;
  workflowId: string | null;
  phaseId: string | null;
}

export interface RuntimePreparedTurnAccessPolicy {
  conversationId: string;
  userId: string;
  workflowId: string | null;
  phaseId: string | null;
  permissionMode: AgentPermissionMode;
  workspaceId: string | null;
  policyVersion: number;
}

export interface RuntimeEffectiveAccessPolicy extends RuntimeTaskAccessScope {
  conversationId: string;
  userId: string;
  permissionMode: AgentPermissionMode;
  workspaceId: string | null;
  policyVersion: number;
}

export interface RuntimeConversationSettingsSnapshot {
  conversationId: string;
  userId: string;
  workspaceId: string | null;
  workspace: {
    workspaceId: string;
    rootPath: string;
    displayName: string;
    trustLevel: string;
    writable: boolean;
  } | null;
  permissionMode: AgentPermissionMode;
  version: number;
  updatedAt: string;
}
