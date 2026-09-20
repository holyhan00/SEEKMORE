                                                          
import type { MemoryCandidate, MemoryNamespace } from '../kernel/memory.types';

export type MemoryWriteIntent =
  | 'remember'
  | 'forget'
  | 'update'
  | 'correct'
  | 'restore'
  | 'implicit_candidate'
  | 'none';
export type MemoryReadIntent = 'recall' | 'use_context' | 'none';

export type MemoryWriteFrame = {
  intent: MemoryWriteIntent;
  explicitness: 'explicit' | 'implicit';
  confidence: number;
  namespace: MemoryNamespace;
  source: {
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
    traceId?: string | null;
  };
  userText?: string | null;
  assistantText?: string | null;
  confirmedCandidates?: MemoryCandidate[];
  targetMemoryIds?: string[];
  operationSource?: 'conversation' | 'management_ui' | 'api' | 'system';
  operationActor?: {
    userId?: string | null;
    agentId?: string | null;
    role?: string | null;
  };
  reason?: string | null;
};

export type MemoryReadFrame = {
  intent: MemoryReadIntent;
  namespace: MemoryNamespace;
  query: string;
  source?: {
    conversationId?: string | null;
    userMessageId?: string | null;
    traceId?: string | null;
  };
  maxItems?: number;
};
