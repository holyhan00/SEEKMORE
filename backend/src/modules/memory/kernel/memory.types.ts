                                                    
import type {
  MemoryAdmissionAction,
  MemoryAdmissionReason,
  MemoryEvidenceSource,
  MemoryKind,
  MemoryScopeLevel,
  MemorySensitivity,
  MemoryStability,
  MemoryStatus,
} from './memory.constants';

export type MemoryNamespace = {
  tenantId?: string | null;
  orgId?: string | null;
  groupId?: string | null;
  planId?: string | null;
  projectId?: string | null;
  userId: string;
  agentId?: string | null;
  conversationId?: string | null;
};

export type MemoryActor = {
  actorUserId: string;
  actorAgentId?: string | null;
  roles?: string[];
  tenantId?: string | null;
  orgId?: string | null;
};

export type MemorySourceRef = {
  conversationId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  traceId?: string | null;
  quote?: string | null;
  source: MemoryEvidenceSource;
};

export type MemoryCandidate = {
  kind: MemoryKind;
  subject: string;
  predicate: string;
  value: unknown;
  summary: string;
  scopeLevel: MemoryScopeLevel;
  stability: MemoryStability;
  sensitivity: MemorySensitivity;
  confidence: number;
  evidence: MemorySourceRef;
  tags?: string[];
  sourceHash?: string | null;
};

export type MemoryFactRecord = {
  id: string;
  namespace: MemoryNamespace;
  scopeLevel: MemoryScopeLevel;
  kind: MemoryKind;
  subject: string;
  predicate: string;
  valueJson: unknown;
  summary: string;
  searchText: string;
  status: MemoryStatus;
  confidence: number;
  stability: MemoryStability;
  sensitivity: MemorySensitivity;
  source: MemorySourceRef;
  validFrom?: string | null;
  validTo?: string | null;
  lastUsedAt?: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryAdmissionDecision = {
  action: MemoryAdmissionAction;
  reason: MemoryAdmissionReason;
  candidate: MemoryCandidate;
  targetMemoryId?: string | null;
  confidence: number;
};

export type MemoryRetrievalItem = {
  id: string;
  kind: MemoryKind;
  scopeLevel: MemoryScopeLevel;
  summary: string;
  valueJson: unknown;
  confidence: number;
  score: number;
  sensitivity: MemorySensitivity;
  stability: MemoryStability;
  source: MemorySourceRef;
  updatedAt: string;
  lastUsedAt?: string | null;
  usageCount: number;
};

export type MemoryContextBlock = {
  id: string;
  kind: 'memory_context';
  title: string | null;
  content: string;
  metadata: {
    itemCount: number;
    tokenCost: number;
    usedMemoryIds: string[];
    citations: Array<{
      memoryId: string;
      sourceMessageId?: string | null;
      sourceConversationId?: string | null;
    }>;
    scope: MemoryNamespace;
  };
};

export type BuildMemoryContextInput = {
  traceId?: string | null;
  actor: MemoryActor;
  namespace: MemoryNamespace;
  query: string;
  recentMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  modelContextLimit?: number;
  reservedForOutput?: number;
  maxItems?: number;
  maxChars?: number;
};

export type BuildMemoryContextOutput = {
  blocks: MemoryContextBlock[];
  retrieved: MemoryRetrievalItem[];
  skipped: boolean;
  reason?: string;
};

export type WriteMemoryInput = {
  traceId?: string | null;
  actor: MemoryActor;
  namespace: MemoryNamespace;
  frame: import('../frames/memory-frame.types').MemoryWriteFrame;
};

export type WriteMemoryOutput = {
  accepted: number;
  skipped: number;
  updated: number;
  deleted: number;
  decisions: MemoryAdmissionDecision[];
};
