import type { Socket } from 'socket.io-client';
import type {
  RuntimeApprovalDecisionPayload,
  RuntimeApprovedDecision,
} from '../../runtime/approval/runtimeApprovalClient';

export type RuntimeApprovalPayload = Omit<RuntimeApprovalDecisionPayload, 'decision'>;

export function approveRuntimeOperation(
  socket: Socket | null,
  payload: RuntimeApprovalPayload & { decision: RuntimeApprovedDecision },
  touch: () => void,
): boolean {
  return emitDecision(socket, 'runtime.approval_approved', payload, payload.decision, touch);
}

export function rejectRuntimeOperation(
  socket: Socket | null,
  payload: RuntimeApprovalPayload & { decision?: 'rejected' },
  touch: () => void,
): boolean {
  return emitDecision(socket, 'runtime.approval_rejected', payload, payload.decision ?? 'rejected', touch);
}

function emitDecision(
  socket: Socket | null,
  event: 'runtime.approval_approved' | 'runtime.approval_rejected',
  payload: RuntimeApprovalPayload,
  decision: RuntimeApprovalDecisionPayload['decision'],
  touch: () => void,
): boolean {
  const approvalId = text(payload.approvalId);
  const conversationId = text(payload.conversationId);
  if (!socket || !approvalId) {
    console.warn('[RuntimeApproval] decision skipped', { event, hasSocket: Boolean(socket), approvalId, conversationId, decision });
    return false;
  }
  const normalized = {
    approvalId,
    conversationId: conversationId || undefined,
    taskRunId: payload.taskRunId ?? undefined,
    decision,
  };
                                                               
  socket.emit(event, normalized, () => {
                                                                                
  });
  touch();
  return true;
}
function text(value: unknown): string { return String(value ?? '').trim(); }
