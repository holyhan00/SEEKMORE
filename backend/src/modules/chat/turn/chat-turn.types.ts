                                                   

import type { ChatOutputWarning } from '../types/chat.events';
import type { ChatObjectCardDto, ChatObjectRefInput } from '../../object-runtime/message-object/message-object.types';
import type { ClientLocaleSnapshot, ResolvedLocaleContext } from '../../localization/locale.types';

export type RuntimeRuntimeOptions = {
  enabledCapabilityKinds?: string[];
  enabledToolNames?: string[];
  toolDecisionMaxIterations?: number;
  workspaceId?: string | null;
  permissionMode?:
    | 'confirm_required'
    | 'audit_autorun'
    | 'full_access';
  approvalId?: string | null;
  approvalDecision?:
    | 'approved_once'
    | 'audit_only'
    | 'full_access_for_task'
    | 'rejected'
    | null;
};

export interface ChatTurnMessageEnvelope {
  id: string;
  conversationId: string;
  role: 'user' | 'agent';
  parentMessageId: string | null;
  rootMessageId: string | null;
  branchId: string | null;
  content: string;
  createdAt: string;
  is_complete: boolean;
  traceId: string;
}

export interface ChatTurnAnchors {
  userMessageId: string;
  assistantMessageId: string;
  userMessage: ChatTurnMessageEnvelope;
  assistantMessage: ChatTurnMessageEnvelope;
}

export interface StartChatTurnInput {
  resume?: boolean;
  traceId: string;
  requestId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  content: string;
  clientMessageId?: string | null;
  model?: string | null;
  objectRefs?: ChatObjectRefInput[];
  runtimeOptions?: RuntimeRuntimeOptions;
  explicitSkillIds?: string[];
  localeContext?: ClientLocaleSnapshot | null;
  resolvedLocale?: ResolvedLocaleContext;
  onStarted?: (metadata: ChatTurnAnchors) => void | Promise<void>;
  onDelta?: (
    chunk: string,
    metadata: Pick<
      ChatTurnAnchors,
      'userMessageId' | 'assistantMessageId'
    >,
  ) => void | Promise<void>;
  onObjects?: (
    objects: ChatObjectCardDto[],
    metadata: Pick<
      ChatTurnAnchors,
      'userMessageId' | 'assistantMessageId'
    >,
  ) => void | Promise<void>;
  abortSignal?: AbortSignal;
}

export interface ChatTurnResult {
  traceId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  citations: unknown[] | null;
  runtime: Record<string, unknown> | null;
  objects: ChatObjectCardDto[];
  warnings: ChatOutputWarning[];
  reasonCodes: string[];
  terminalStatus:
    | 'succeeded'
    | 'partially_succeeded'
    | 'failed'
    | 'cancelled'
    | 'blocked'
    | 'waiting_approval'
    | 'waiting_external' | 'waiting_user';
}
