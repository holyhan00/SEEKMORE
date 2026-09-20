import type { ResolvedLocaleContext } from '../modules/localization/locale.types';
export type Dict<T = unknown> = Record<string, T>;

export type ToolSideEffectClass =
  | 'none'
  | 'read_only'
  | 'object_create'
  | 'workspace_write'
  | 'irreversible_write'
  | 'process_execution'
  | 'external_effect';

export type ToolIdempotencyMode = 'none' | 'optional' | 'required';

export type ToolRequiredSurface = 'conversation' | 'workspace' | 'browser' | 'desktop' | 'artifact' | 'external';
export type ToolParallelism = 'parallel_safe' | 'resource_serial' | 'interactive_serial';
export type ToolTurnBehavior = 'continue' | 'finish_on_success';
export type ToolBatchBehavior = 'coexist' | 'exclusive';
export type ToolPresentation = 'activity' | 'workflow' | 'hidden';
export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'forbidden';

export interface ToolRiskAssessmentOverride {
  riskLevel?: ToolRiskLevel;
  requiresApproval?: boolean;
  reasonCodes?: string[];
  descriptor?: unknown;
}

export interface ToolRiskAssessmentContext {
  workspaceId: string | null;
}

export interface ToolContext {
  userId: string;
  conversationId: string;
  userMessageId?: string;
  assistantMessageId?: string;
  traceId?: string;
  requestId?: string;
  tenantId?: string;
  roles?: string[];
  scopes?: string[];
  idempotencyKey?: string;
  abortSignal?: AbortSignal;
  localization?: ResolvedLocaleContext;
  metadata?: Dict;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  status: 'ok' | 'error' | 'cancelled';
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta: {
    tool: string;
    version?: string;
    duration_ms: number;
    traceId?: string;
    requestId?: string;
    idempotencyKey?: string;
  };
}

export interface Tool {
  name: string;
  version?: string;
  runtimeOnly?: boolean;
  description: string;
  tags?: string[];
  timeoutMs?: number;
  inputSchema?: object;
  outputSchema?: object;
  sideEffectClass?: ToolSideEffectClass;
  idempotency?: ToolIdempotencyMode;
  requiresApproval?: boolean;
  maxOutputBytes?: number;
  sensitiveInputKeys?: string[];
  displayName?: string;
  providerKind?: 'internal' | 'mcp' | 'knowledge' | 'memory' | 'web' | 'code' | 'database' | 'object' | 'computer';
  capabilityKinds?: string[];
  sourceTypes?: Array<'web' | 'repository' | 'documentation' | 'paper' | 'local_file' | 'knowledge' | 'api' | 'runtime_result' | 'artifact' | 'object' | 'unknown'>;
  riskLevel?: ToolRiskLevel;
  requiredSurfaces?: ToolRequiredSurface[];
  parallelism?: ToolParallelism;
  batchBehavior?: ToolBatchBehavior;
  turnBehavior?: ToolTurnBehavior;
  presentation?: ToolPresentation;
  conflictKeyFields?: string[];
  supportsAbort?: boolean;
  latencyClass?: 'instant' | 'short' | 'long';
  assessRisk?: (
    args: Dict,
    context: ToolRiskAssessmentContext,
  ) => ToolRiskAssessmentOverride | Promise<ToolRiskAssessmentOverride>;
  validateArgs?: (args: Dict) => void | Promise<void>;
  canExecute?: (ctx: ToolContext, args: Dict) => boolean | Promise<boolean>;
  execute: (args: Dict, ctx: ToolContext, signal?: AbortSignal) => Promise<unknown>;
}

export interface ToolObserver {
  onStart?(event: {
    tool: string;
    version?: string;
    argsPreview: string;
    ctx: Pick<ToolContext, 'userId' | 'conversationId' | 'traceId' | 'requestId' | 'idempotencyKey'>;
    ts: number;
  }): void;
  onSuccess?(event: {
    tool: string;
    version?: string;
    duration_ms: number;
    ctx: Pick<ToolContext, 'userId' | 'conversationId' | 'traceId' | 'requestId'>;
    ts: number;
  }): void;
  onError?(event: {
    tool: string;
    version?: string;
    duration_ms: number;
    error: { code: string; message: string };
    ctx: Pick<ToolContext, 'userId' | 'conversationId' | 'traceId' | 'requestId'>;
    ts: number;
  }): void;
}

export class ToolError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface DispatchOptions {
  timeoutMs?: number;
  idempotencyTtlMs?: number;
  maxConcurrent?: number;
}
