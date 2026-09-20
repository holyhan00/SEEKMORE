export type ChatTurnPhase =
  | 'idle' | 'submitting' | 'starting' | 'running'
  | 'waiting_user' | 'waiting_approval' | 'waiting_external' | 'cancelling';

export interface ActiveChatTurnView {
  requestId: string;
  clientMessageId: string;
  conversationId: string;
  traceId: string | null;
  sequence: string;
  version: number;
  position: number;
  status: 'STARTING' | 'RUNNING' | 'WAITING_APPROVAL' | 'WAITING_USER' | 'WAITING_EXTERNAL' | 'CANCELLING';
  userMessageId: string | null;
  assistantMessageId: string | null;
  content: string;
  objectCount: number;
  createdAt: string;
}

export interface ChatTurnQueueSnapshot {
  conversationId: string;
  active: ActiveChatTurnView | null;
  lastEventSequence: string;
  inputs?: TurnInputBubble[];
}

import type { ClientLocaleSnapshot } from '../../../../localization/locale.types';

export interface ChatTurnSubmitPayload {
  expectedTraceId?: string;
  clientMessageId: string;
  conversationId: string;
  agentId: string;
  content: string;
  objectRefs: Array<{ objectId: string; position: number }>;
  model?: string | null;
  runtimeOptions?: Record<string, unknown> | null;
  explicitSkillIds?: string[];
  localeContext?: ClientLocaleSnapshot;
}

export interface StopChatTurnPayload {
  conversationId: string;
  expectedTraceId?: string;
  expectedRequestId?: string;
  reason: 'user_requested';
}

export type SubmitChatTurnAck =
  | { ok: true; requestId: string; clientMessageId: string; conversationId: string; traceId: string | null; status: string; queuePosition: number; sequence: string; version: number }
  | { ok: false; code: string; message: string };

export type StopChatTurnAck =
  | { ok: true; status: 'CANCELLING' | 'CANCELLED' | 'NOT_ACTIVE' | 'TERMINAL'; traceId: string | null }
  | { ok: false; code: string; message: string };


export interface TurnInputBubble {
  id: string; clientInputId: string; userMessageId?: string;
  turn?: { userMessageId: string; traceId: string };
  kind: 'STEERING' | 'USER_RESPONSE'; content: string; sequence: number;
  objects?: unknown[];
}
