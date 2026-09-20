                                                         
import type { ModelCapabilities } from '../../llm-settings/contracts/llm-settings.types';
import type { ResolvedLocaleContext } from '../../localization/locale.types';
export type AgentPermissionMode = 'confirm_required' | 'audit_autorun' | 'full_access';
export type AgentApprovalDecision = 'approved_once' | 'audit_only' | 'full_access_for_task' | 'rejected';

export interface AgentTurnExecutionOptions {
  enabledCapabilityKinds?: string[];
  enabledToolNames?: string[];
  runtimeToolNames?: string[];
  disabledToolNames?: string[];
  toolDecisionMaxIterations?: number;
  workspaceId?: string | null;
  permissionMode?: AgentPermissionMode;
  accessPolicyVersion?: number;
  approvalId?: string | null;
  approvalDecision?: AgentApprovalDecision | null;
  approvalDescriptorHash?: string | null;
}



export interface AgentTurnExecutionInput {
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  parentMessageId: string | null;
  userMessageId: string;
  contextLeafMessageId: string;
  assistantMessageId: string;
  input: string;
  model?: string | null;
  stream: boolean;
  onToken?: (token: string) => Promise<void> | void;
  onObjects?: (objects: Array<Record<string, unknown>>) => Promise<void> | void;
  abortSignal?: AbortSignal;
  runtimeOptions?: AgentTurnExecutionOptions;
  externalContext?: Record<string, unknown> | null;
  localization?: ResolvedLocaleContext;
}

export type AgentTurnOutcome =
  | {
      kind: 'terminal';
      status: 'succeeded' | 'partial' | 'failed' | 'blocked' | 'cancelled';
      reasonCodes: string[];
      warnings: string[];
    }
  | {
      kind: 'paused';
      reason: 'approval' | 'user_input' | 'external_dependency';
      resumeToken?: string | null;
      reasonCodes: string[];
      warnings: string[];
    };

export interface AgentTurnExecutionResult {
  traceId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  citations: unknown[];
  objects: unknown[];
  runtime: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  warnings: string[];
  reasonCodes: string[];
  outcome: AgentTurnOutcome;
}

export interface AgentRuntimeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: string;
}

export interface AgentTextContentPart {
  type: 'text';
  text: string;
}

export interface AgentImageContentPart {
  type: 'image';
  objectId: string;
  mimeType: string;
  dataBase64: string;
}

export type AgentRuntimeContentPart = AgentTextContentPart | AgentImageContentPart;
export type AgentRuntimeMessageContent = string | AgentRuntimeContentPart[] | Record<string, unknown> | null;

export interface AgentRuntimeMessage {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: AgentRuntimeMessageContent;
  parentMessageId?: string | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: AgentRuntimeToolCall[];
  reasoningContent?: string;
}

export interface AgentRuntimeToolDefinition {
  metadata?: { canonicalName: string; namespace: string; capabilityKinds: string[]; requiredSurfaces: string[]; sourceTypes?: string[];
    providerKind?: string; sideEffectClass?: string; runtimeOnly?: boolean };
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentModelRoute {
  provider: string;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  apiMode?: string | null;
  headers?: Record<string, string>;
  protocol?: string | null;
  capabilities?: ModelCapabilities;
}

export interface AgentAttachedObject {
  objectId: string;
  displayName: string;
  originalName: string;
  objectKind: string;
  originType: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  versionNo: number;
  status: string;
  downloadUrl: string;
  position: number;
  processingStatus: 'ready' | 'unsupported';
  capabilities: string[];
  contentSummary: string | null;
  processor: string | null;
  processorVersion: string | null;
  sourceTool: string | null;
  generationIntent: string | null;
  generationBatchId: string | null;
  generationIndex: number | null;
  currentUse: {
    role: 'user_input' | 'assistant_output';
    messageId: string | null;
    inputId: string | null;
    inputKind: 'PRIMARY' | 'STEERING' | 'USER_RESPONSE' | null;
    position: number;
  };
  media: {
    width?: number;
    height?: number;
    format?: string;
    hasAlpha?: boolean;
  } | null;
}

export interface AgentRuntimeExecutionContext {
  kind: 'normal' | 'grow_focus';
  reviewId?: string;
}

export interface AgentRuntimeTurnRequest {
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  parentMessageId: string | null;
  branchId: string | null;
  branchObjectIds?: string[];
  input: string;
  messages: AgentRuntimeMessage[];
  agent: {
    name: string;
    instructions: string;
    model: string;
    provider: string;
    baseUrl?: string | null;
    apiKey?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
    apiMode?: string | null;
    contextWindow?: number | null;
    reasoningEffort?: string | null;
    headers?: Record<string, string>;
    protocol?: string | null;
    capabilities: ModelCapabilities;
    fallbacks?: AgentModelRoute[];
  };
  workspace: {
    workspaceId: string | null;
    rootPath: string | null;
    readAllowed: boolean;
    writeAllowed: boolean;
  };
  permissionMode: AgentPermissionMode;
  accessPolicyVersion: number;
  tools: AgentRuntimeToolDefinition[];
  attachedObjects: AgentAttachedObject[];
  localization: ResolvedLocaleContext;
  maxIterations: number;
  timeouts: {
    firstToken: number;
    idle: number;
    modelTotal: number;
    tool: number;
  };
     
                                                                      
                                                                         
                                          
     
  executionContext?: AgentRuntimeExecutionContext;
}
