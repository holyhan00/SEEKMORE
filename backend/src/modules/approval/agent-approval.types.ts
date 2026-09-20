import type { AgentApprovalDecision, AgentPermissionMode } from '../seekmore-agent/contracts/agent-turn.types';
import type {
  RuntimeApprovalScopeType,
  RuntimeRiskLevel,
} from './runtime-access-policy.types';

export interface AgentApprovalRequest {
  approvalId: string;
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  assistantMessageId: string;
  toolCallId: string | null;
  toolName: string;
  scopeType: RuntimeApprovalScopeType;
  scopeId: string;
  workflowId: string | null;
  phaseId: string | null;
  stepId: string | null;
  iteration: number | null;
  taskRunId: string;
  riskLevel: RuntimeRiskLevel;
  descriptorHash: string;
  policyVersionAtRequest: number;
  permissionMode: AgentPermissionMode;
  status: 'pending' | 'approved' | 'rejected' | 'resumed' | 'resume_failed' | 'expired' | 'cancelled';
  decision?: AgentApprovalDecision | null;
  createdAt: string;
  decidedAt?: string | null;
  resumedAt?: string | null;
  resumeError?: string | null;
  actionPreview: unknown;
}
