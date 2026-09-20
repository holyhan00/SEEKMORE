export type RuntimeApprovalDecision =
  | 'approved_once'
  | 'audit_only'
  | 'full_access_for_task'
  | 'rejected';

export type RuntimeApprovedDecision = Exclude<RuntimeApprovalDecision, 'rejected'>;

export type RuntimeApprovalDecisionPayload = {
  approvalId: string;
  conversationId?: string | null;
  taskRunId?: string | null;
  decision: RuntimeApprovalDecision;
};
