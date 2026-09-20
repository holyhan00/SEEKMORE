                                                          
export type MemoryStatus = 'active' | 'pending_confirmation' | 'superseded' | 'deleted' | 'conflicted';
export type MemoryStatusFilter = MemoryStatus | 'all';
export type MemoryScopeLevel = 'user' | 'agent' | 'conversation' | 'project' | 'org' | 'group' | 'plan';
export type MemoryScopeLevelFilter = MemoryScopeLevel | 'all';
export type MemoryKind =
  | 'identity'
  | 'preference'
  | 'constraint'
  | 'project_state'
  | 'goal'
  | 'relationship'
  | 'workflow'
  | 'tool_preference'
  | 'event'
  | 'episode';
export type MemorySensitivity = 'normal' | 'private' | 'sensitive' | 'restricted';

export type MemoryScopeQuery = {
  tenantId?: string | null;
  orgId?: string | null;
  groupId?: string | null;
  planId?: string | null;
  projectId?: string | null;
  agentId?: string | null;
  conversationId?: string | null;
};

export type MemorySourceRef = {
  conversationId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  traceId: string | null;
  quote: string | null;
  source: string;
};

export type MemoryFactRecord = {
  id: string;
  namespace: MemoryScopeQuery & { userId: string };
  scopeLevel: MemoryScopeLevel;
  kind: MemoryKind;
  subject: string;
  predicate: string;
  valueJson: unknown;
  summary: string;
  searchText: string;
  status: MemoryStatus;
  confidence: number;
  stability: 'long_term' | 'session' | 'ephemeral';
  sensitivity: MemorySensitivity;
  source: MemorySourceRef;
  validFrom: string | null;
  validTo: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type ListMemoryParams = MemoryScopeQuery & {
  status?: MemoryStatusFilter;
  scopeLevel?: MemoryScopeLevelFilter | null;
  kind?: MemoryKind | null;
  sensitivity?: MemorySensitivity | null;
  keyword?: string | null;
  cursor?: string | null;
  limit?: number;
};
