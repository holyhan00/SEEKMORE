                                                           
import type { MemoryCandidate, MemoryNamespace } from '../kernel/memory.types';

export type JwtUserLike = {
  id: string;
  role?: string;
  roles?: string[];
};

export type MemoryScopeInput = {
  tenantId?: string | null;
  orgId?: string | null;
  groupId?: string | null;
  planId?: string | null;
  projectId?: string | null;
  agentId?: string | null;
  conversationId?: string | null;
};

export type BuildContextInput = {
  traceId?: string | null;
  user: JwtUserLike;
  scope: MemoryScopeInput;
  query: string;
  recentMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  maxItems?: number;
  maxChars?: number;
};

export type WriteBackInput = {
  traceId?: string | null;
  user: JwtUserLike;
  scope: MemoryScopeInput;
  intent: 'remember' | 'forget' | 'update' | 'correct' | 'restore' | 'implicit_candidate' | 'none';
  explicitness: 'explicit' | 'implicit';
  userText?: string | null;
  assistantText?: string | null;
  source?: {
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
  };
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

export type ListMemoryInput = {
  user: JwtUserLike;
  scope: MemoryScopeInput;
  cursor?: string | null;
  limit?: number;
};

export function toNamespace(user: JwtUserLike, scope: MemoryScopeInput): MemoryNamespace {
  return {
    tenantId: scope.tenantId ?? null,
    orgId: scope.orgId ?? null,
    groupId: scope.groupId ?? null,
    planId: scope.planId ?? null,
    projectId: scope.projectId ?? null,
    userId: user.id,
    agentId: scope.agentId ?? null,
    conversationId: scope.conversationId ?? null,
  };
}