import type { RuntimeRuntimeOptions } from './chat-turn.types';
import type { ClientLocaleSnapshot } from '../../localization/locale.types';

export type ChatTurnRequestStatus =
  | 'QUEUED' | 'STARTING' | 'RUNNING' | 'WAITING_APPROVAL'
  | 'WAITING_EXTERNAL' | 'WAITING_USER' | 'CANCELLING' | 'CANCELLED' | 'SUCCEEDED'
  | 'PARTIAL' | 'FAILED' | 'BLOCKED' | 'DELETED';

export type ChatTurnCleanupStatus =
  | 'NOT_REQUIRED' | 'PENDING' | 'CONFIRMED' | 'PARTIAL' | 'TIMED_OUT';

export const ACTIVE_CHAT_TURN_STATUSES: readonly ChatTurnRequestStatus[] = [
  'STARTING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_EXTERNAL', 'WAITING_USER', 'CANCELLING',
];

export const EXECUTION_TERMINAL_CHAT_TURN_STATUSES: readonly ChatTurnRequestStatus[] = [
  'CANCELLED', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'BLOCKED',
];

export interface PersistedChatTurnPayload {
  content: string;
  objectRefs: Array<{ objectId: string; position: number }>;
  model: string | null;
  runtimeOptions: RuntimeRuntimeOptions | null;
  explicitSkillIds: string[];
  localeContext: ClientLocaleSnapshot | null;
}

export interface SubmitChatTurnCommand extends PersistedChatTurnPayload {
  expectedTraceId?: string;
  userId: string;
  agentId: string;
  conversationId: string;
  clientMessageId: string;
}

export interface StopChatTurnCommand {
  userId: string;
  conversationId: string;
  expectedTraceId?: string;
  expectedRequestId?: string;
  reason: 'user_requested';
}

export interface ChatTurnRequestView {
  requestId: string;
  clientMessageId: string;
  conversationId: string;
  traceId: string | null;
  sequence: string;
  version: number;
  position: number;
  status: ChatTurnRequestStatus;
  content: string;
  objectCount: number;
  userMessageId: string | null;
  assistantMessageId: string | null;
  createdAt: string;
}

export interface ChatTurnQueueSnapshot {
  conversationId: string;
  active: ChatTurnRequestView | null;
  queued: ChatTurnRequestView[];
  lastEventSequence: string;
  inputs?: unknown[];
}

export type ChatTurnDeliveryType =
  | 'chat.turn.input' | 'chat.turn.accepted' | 'chat.turn.started'
  | 'chat.turn.cancel_requested' | 'chat.turn.cancelled'
  | 'chat.response.delta' | 'chat.turn.objects' | 'chat.response.completed' | 'chat.response.failed'
  | 'chat.queue.snapshot' | 'chat.queue.updated';

export interface ChatTurnDeliveryEnvelope<T = unknown> {
  type: ChatTurnDeliveryType;
  userId: string;
  conversationId: string;
  requestId: string;
  traceId: string | null;
  eventSequence: string;
  occurredAt: string;
  payload: T;
}

export function isActiveStatus(status: ChatTurnRequestStatus): boolean {
  return ACTIVE_CHAT_TURN_STATUSES.includes(status);
}

export function isExecutionTerminalStatus(status: ChatTurnRequestStatus): boolean {
  return EXECUTION_TERMINAL_CHAT_TURN_STATUSES.includes(status);
}
