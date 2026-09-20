import type { ToolPresentation } from '../../../tools/toolstypes';
import type { ResolvedLocaleContext } from '../../localization/locale.types';
import type { AgentPermissionMode, AgentRuntimeToolCall } from './agent-turn.types';

export interface AgentToolInvocationRequest {
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  branchObjectIds?: string[];
  toolCallId: string;
  iteration: number;
  stepId: string;
  modelId?: string;
  modelProvider?: string;
  name: string;
  arguments: Record<string, unknown>;
  permissionMode: AgentPermissionMode;
  localization: ResolvedLocaleContext;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  workspace: {
    workspaceId?: string | null;
    rootPath?: string | null;
    readAllowed?: boolean;
    writeAllowed?: boolean;
  };
}

export type AgentToolResult =
  | {
      status: 'completed';
      observation: string;
      evidence?: {
        exitCode?: number;
        running?: boolean;
        sessionId?: string;
        target?: string;
        contentHash?: string;
        objectObservations?: Array<{ objectId: string; contentHash: string; versionNo: number; observedAt?: string }>;
        source: 'tool_result';
      };
      completionText?: string;
      objects?: Array<Record<string, unknown>>;
      citations?: Array<Record<string, unknown>>;
    }
  | {
      status: 'requires_confirmation';
      approvalId: string;
      reason: string;
      actionPreview: unknown;
    }
  | {
      status: 'failed';
      errorCode: string;
      message: string;
      retryable: boolean;
      metadata?: Record<string, unknown>;
    };

export interface AgentToolExecutionSnapshot {
  executionId: string;
  toolCallId: string;
  toolName: string;
  status: AgentToolResult['status'];
  ok: boolean | null;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  summary: string;
  errorCode: string | null;
  retryable: boolean | null;
}

export interface AgentToolExecutionRecord {
  canonicalName?: string;
  sideEffectClass?: string;
  call: AgentRuntimeToolCall;
  result: AgentToolResult;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  fingerprint: string;
  finishTurn?: boolean;
  presentation?: ToolPresentation;
}
