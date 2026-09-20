                                                        
export const MEMORY_SCHEMA_VERSION = 3 as const;

export const MEMORY_DEFAULT_CONTEXT_LIMIT = 128_000;
export const MEMORY_DEFAULT_RESERVED_FOR_OUTPUT = 4_096;
export const MEMORY_DEFAULT_MAX_INJECTED_ITEMS = 12;
export const MEMORY_DEFAULT_MAX_INJECTED_CHARS = 8_000;

export type MemoryScopeLevel =
  | 'user'
  | 'agent'
  | 'conversation'
  | 'project'
  | 'org'
  | 'group'
  | 'plan';

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

export type MemoryStability = 'long_term' | 'session' | 'ephemeral';

export type MemoryStatus =
  | 'active'
  | 'superseded'
  | 'deleted'
  | 'conflicted'
  | 'pending_confirmation';

export type MemorySensitivity =
  | 'normal'
  | 'private'
  | 'sensitive'
  | 'restricted';

export type MemoryEvidenceSource =
  | 'explicit_user_statement'
  | 'user_confirmed'
  | 'conversation_turn'
  | 'system_event'
  | 'tool_event'
  | 'project_event'
  | 'admin';

export type MemoryAdmissionAction =
  | 'write'
  | 'skip'
  | 'ask_confirmation'
  | 'update_existing'
  | 'supersede'
  | 'delete'
  | 'restore';

export type MemoryAdmissionReason =
  | 'explicit_memory_request'
  | 'user_confirmed'
  | 'stable_preference'
  | 'stable_constraint'
  | 'project_state'
  | 'conversation_event'
  | 'low_confidence'
  | 'ephemeral_task'
  | 'privacy_sensitive'
  | 'duplicate'
  | 'conflict_detected'
  | 'unsupported_candidate'
  | 'missing_evidence'
  | 'strong_target'
  | 'missing_target'
  | 'already_deleted'
  | 'already_active'
  | 'management_action';