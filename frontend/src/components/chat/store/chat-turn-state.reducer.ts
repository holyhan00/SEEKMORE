import type {
  TurnInputBubble,
  ActiveChatTurnView,
  ChatTurnPhase,
  ChatTurnQueueSnapshot,
} from '../hooks/socket/chat-turn-contracts';

export interface ChatConversationTurnState {
  conversationId: string;
  phase: ChatTurnPhase;
  activeRequestId: string | null;
  activeTraceId: string | null;
  activeUserMessageId: string | null;
  activeAssistantMessageId: string | null;
  inputs: TurnInputBubble[];
  lastEventSequence: string | null;
  hydrated: boolean;
}

export function emptyChatTurnState(conversationId: string): ChatConversationTurnState {
  return {
    conversationId, phase: 'idle', activeRequestId: null, activeTraceId: null,
    activeUserMessageId: null, activeAssistantMessageId: null, inputs: [], lastEventSequence: null, hydrated: false,
  };
}

export function reduceChatTurnState(
  state: ChatConversationTurnState,
  type: string,
  raw: unknown,
): ChatConversationTurnState {
  const event = record(raw);
  const eventSequence = text(event.eventSequence);
  if (eventSequence && state.lastEventSequence && compareSequence(eventSequence, state.lastEventSequence) <= 0) return state;
  const next = { ...state, lastEventSequence: eventSequence || state.lastEventSequence };

  if (type === 'chat.turn.input') {
    const item = event as unknown as TurnInputBubble;
    if (!['STEERING', 'USER_RESPONSE'].includes(item.kind)) return next;
    return { ...next, inputs: [...next.inputs.filter((row) => row.id !== item.id), item] };
  }
  if (type === 'chat.queue.snapshot'  || type === 'chat.queue.updated') {
    return applySnapshot(next, event as unknown as ChatTurnQueueSnapshot);
  }
  if (type === 'chat.turn.accepted') return { ...next, hydrated: true };
  if (type === 'chat.turn.started') {
    return {
      ...next,
      phase: 'running',
      activeRequestId: text(event.requestId) || null,
      activeTraceId: text(event.traceId) || null,
      activeUserMessageId: text(event.userMessageId) || null,
      activeAssistantMessageId: text(event.assistantMessageId) || null,
      hydrated: true,
    };
  }
  if (type === 'chat.turn.cancel_requested') return { ...next, phase: 'cancelling' };
  if (type === 'chat.turn.cancelled' || type === 'chat.response.completed' || type === 'chat.response.failed') {
    if (next.activeTraceId && text(event.traceId) && next.activeTraceId !== text(event.traceId)) return next;
    return { ...next, phase: 'idle', activeRequestId: null, activeTraceId: null, activeUserMessageId: null, activeAssistantMessageId: null };
  }
  return next;
}

function applySnapshot(state: ChatConversationTurnState, snapshot: ChatTurnQueueSnapshot): ChatConversationTurnState {
  const active = snapshot.active as ActiveChatTurnView | null;
  return {
    ...state,
    inputs: snapshot.inputs ?? state.inputs,
    phase: active ? phaseOf(active.status) : 'idle',
    activeRequestId: active?.requestId ?? null,
    activeTraceId: active?.traceId ?? null,
    activeUserMessageId: active?.userMessageId ?? null,
    activeAssistantMessageId: active?.assistantMessageId ?? null,
    lastEventSequence: text((snapshot as any).eventSequence ?? snapshot.lastEventSequence) || state.lastEventSequence,
    hydrated: true,
  };
}

function phaseOf(status: ActiveChatTurnView['status']): ChatTurnPhase {
  if (status === 'STARTING') return 'starting';
  if (status === 'WAITING_USER') return 'waiting_user';
  if (status === 'WAITING_APPROVAL') return 'waiting_approval';
  if (status === 'WAITING_EXTERNAL') return 'waiting_external';
  if (status === 'CANCELLING') return 'cancelling';
  return 'running';
}

function compareSequence(left: string, right: string): number {
  try { const a = BigInt(left); const b = BigInt(right); return a === b ? 0 : a < b ? -1 : 1; }
  catch { return left.localeCompare(right); }
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
function text(value: unknown): string { return String(value ?? '').trim(); }
