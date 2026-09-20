import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChatConversationTurnState } from '../store/chat-turn-state.reducer';
import type { ChatTurnSubmitPayload, StopChatTurnAck, StopChatTurnPayload, SubmitChatTurnAck } from '../hooks/socket/chat-turn-contracts';

export function stopTarget(turn: ChatConversationTurnState): StopChatTurnPayload | null {
  if (!turn.conversationId || (!turn.activeRequestId && !turn.activeTraceId)) return null;
  return { conversationId: turn.conversationId, expectedRequestId: turn.activeRequestId ?? undefined,
    expectedTraceId: turn.activeTraceId ?? undefined, reason: 'user_requested' };
}

function targetKey(target: StopChatTurnPayload): string {
  return JSON.stringify([target.conversationId, target.expectedRequestId ?? target.expectedTraceId]);
}

/** Keep the click-time identity through disconnect/reconnect; never look up a later target in the client. */
export function requestTurnStop(target: StopChatTurnPayload,
  send: (payload: StopChatTurnPayload) => Promise<StopChatTurnAck>,
  inFlight: Map<string, Promise<StopChatTurnAck>>): Promise<StopChatTurnAck> {
  const frozen = { ...target };
  const key = targetKey(frozen);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = Promise.resolve().then(() => send(frozen))
    .catch((): StopChatTurnAck => ({ ok: false, code: 'STOP_TRANSPORT_FAILED', message: 'STOP_TRANSPORT_FAILED' }))
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, promise);
  return promise;
}

export function useChatComposerController(input: {
  turnState: ChatConversationTurnState;
  submitTurn(payload: ChatTurnSubmitPayload): Promise<SubmitChatTurnAck>;
  stopTurn(payload: StopChatTurnPayload): Promise<StopChatTurnAck>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const stopRequests = useRef(new Map<string, Promise<StopChatTurnAck>>());
  const [pendingStops, setPendingStops] = useState<Set<string>>(new Set());
  const [stopError, setStopError] = useState<string | null>(null);
  const target = stopTarget(input.turnState);
  const key = target ? targetKey(target) : null;
  const stopping = Boolean(key && pendingStops.has(key));
  const stopFailed = Boolean(key && stopError === key);
  const canStop = Boolean(target) && input.turnState.phase !== 'cancelling' && !stopping;
  const submitDraft = useCallback(async (payload: ChatTurnSubmitPayload): Promise<SubmitChatTurnAck> => {
    if (submittingRef.current) return { ok: false, code: 'INPUT_SUBMITTING', message: 'INPUT_SUBMITTING' };
    submittingRef.current = true;
    setSubmitting(true);
    try {
      return await input.submitTurn({ ...payload, expectedTraceId: input.turnState.activeTraceId ?? undefined });
    } finally { submittingRef.current = false; setSubmitting(false); }
  }, [input.submitTurn, input.turnState.activeTraceId]);
  const stopCurrentTurn = useCallback(async () => {
    const captured = stopTarget(input.turnState);
    if (!captured) return null;
    const capturedKey = targetKey(captured);
    setStopError(null);
    setPendingStops((current) => new Set(current).add(capturedKey));
    const ack = await requestTurnStop(captured, input.stopTurn, stopRequests.current);
    setPendingStops((current) => { const next = new Set(current); next.delete(capturedKey); return next; });
    if (!ack.ok) setStopError(capturedKey);
    return ack;
  }, [input.stopTurn, input.turnState.activeRequestId, input.turnState.activeTraceId, input.turnState.conversationId]);
  return useMemo(() => ({ submitting, canStop, stopping, stopFailed, submitDraft, stopCurrentTurn }),
    [submitting, canStop, stopping, stopFailed, submitDraft, stopCurrentTurn]);
}
