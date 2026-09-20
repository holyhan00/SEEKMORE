export type AgentTurnTerminalStatus =
  | 'succeeded'
  | 'partially_succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'budget_exhausted';
export type AgentTurnPauseStatus =
  | 'waiting_for_approval'
  | 'waiting_for_user'
  | 'waiting_for_external_dependency';

export interface AgentTurnFinalizationCommit {
  traceId: string;
  conversationId: string;
  assistantMessageId: string;
  content: string;
  citations?: readonly unknown[] | null;
  runtime?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  reasonCodes?: readonly string[];
  terminalStatus: AgentTurnTerminalStatus;
  finalizationKey: string;
  userId?: string;
  agentId?: string;
  outputObjects?: ReadonlyArray<{ objectId: string; position?: number }>;
  expectedCurrentLeafMessageId?: string | null;
}

export interface AgentTurnPauseCommit {
  traceId: string;
  conversationId: string;
  assistantMessageId: string;
  content: string;
  citations?: readonly unknown[] | null;
  runtime?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  reasonCodes?: readonly string[];
  pauseStatus: AgentTurnPauseStatus;
  finalizationKey: string;
  expectedCurrentLeafMessageId?: string | null;
}
