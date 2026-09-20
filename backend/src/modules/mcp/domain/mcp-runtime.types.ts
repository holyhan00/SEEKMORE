                                                      
import type { JsonObject, JsonValue } from './json.types';

export type McpTransportKind = 'streamable_http' | 'stdio';
export type McpDefinitionSource = 'SYSTEM' | 'USER';
export type McpManagedRuntime = 'REMOTE' | 'DESKTOP' | 'BACKEND_INTERNAL';
export type McpProtocolPreference = 'legacy' | 'auto' | 'modern';
export type McpTrustLevel = 'public' | 'workspace' | 'internal';
export type McpServerStatus = 'enabled' | 'disabled' | 'archived';
export type McpAuthKind = 'none' | 'bearer' | 'api_key' | 'custom_headers' | 'environment' | 'oauth2';
export type McpToolSnapshotStatus = 'available' | 'unavailable' | 'disabled';
export type McpRuntimeScope = 'app' | 'tenant' | 'user' | 'agent' | 'request';

export interface McpRuntimeConfig {
  enabled: boolean;
  clientName: string;
  clientVersion: string;
  defaultTimeoutMs: number;
  maxResultBytes: number;
  maxOAuthStateSeconds: number;
  stdioCommandAllowlist: string[];
  oauthRedirectBaseUrl: string;
}


export interface McpClientConnectionInfo {
  protocolEra: string | null;
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  capabilities: Record<string, unknown>;
  instructions: string | null;
}

export interface McpCapabilityDiscovery {
  connection: McpClientConnectionInfo;
  tools: Record<string, unknown>[];
  resources: Record<string, unknown>[];
  prompts: Record<string, unknown>[];
}

export interface McpPrincipal {
  tenantId?: string;
  userId: string;
  agentId?: string;
  roleIds: string[];
  requestId?: string;
  traceId?: string;
}

export interface McpRuntimeContext {
  conversationId?: string;
  messageId?: string;
  taskId?: string;
  runtimeId?: string;
  requestScopedValues?: JsonObject;
}

export interface McpServerConfig {
  id: string;
  name: string;
  stableKey?: string;
  source?: McpDefinitionSource;
  ownerUserId?: string;
  publisher?: string;
  iconKey?: string;
  visibility?: string;
  reviewStatus?: string;
  originType?: string;
  protocolPreference?: McpProtocolPreference;
  managedRuntime?: McpManagedRuntime;
  workingDirectory?: string;
  displayName?: string;
  description?: string;
  transport: McpTransportKind;
  status: McpServerStatus;
  trustLevel: McpTrustLevel;
  scope: McpRuntimeScope;
  endpoint?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  authKind: McpAuthKind;
  authConfig: JsonObject;
  allowedDomains: string[];
  deniedDomains: string[];
  allowedRoles: string[];
  allowedToolNames: string[];
  deniedToolNames: string[];
  requestScoped: boolean;
  timeoutMs?: number;
  tenantId?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}



export interface McpOAuthState {
  id: string;
  serverId: string;
  tenantId?: string;
  userId: string;
  agentId?: string;
  state: string;
  codeVerifier?: string;
  clientSecret?: string;
  redirectUri: string;
  expiresAt: Date;
  metadata: JsonObject;
  createdAt: Date;
}


export interface McpInvokeInput {
  runtimeToolId: string;
  arguments: JsonObject;
  principal: McpPrincipal;
  context?: McpRuntimeContext;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface McpNormalizedToolResult {
  content: JsonValue[];
  structuredContent?: JsonValue;
  resources: JsonObject[];
  isError: boolean;
  raw: JsonValue;
  truncated: boolean;
}

export interface McpInvokeOutput {
  invocationId: string;
  runtimeToolId: string;
  result: McpNormalizedToolResult;
}

export interface McpAuditEvent {
  eventType: string;
  serverId?: string;
  runtimeToolId?: string;
  tenantId?: string;
  userId?: string;
  agentId?: string;
  traceId?: string;
  severity: 'info' | 'warn' | 'error';
  code?: string;
  message?: string;
  metadata?: JsonObject;
  occurredAt: Date;
}

export type McpSafetyLevel = 'read' | 'write' | 'destructive' | 'external' | 'credential' | 'unknown';
export type McpCapabilityKind =
  | 'mcp.tool'
  | 'mcp.resource'
  | 'mcp.prompt'
  | 'web.browse'
  | 'computer.browser'
  | 'computer.desktop'
  | 'file.read'
  | 'file.write'
  | 'code.execute'
  | 'data.query'
  | 'unknown';

export interface McpRuntimeToolSafety {
  level: McpSafetyLevel;
  requiresConfirmation: boolean;
  reasons: string[];
}

export interface McpRuntimeToolCapability {
  capabilityKinds: McpCapabilityKind[];
  safety: McpRuntimeToolSafety;
  tags: string[];
  source: 'annotations' | 'schema' | 'description' | 'default';
  confidence: number;
}

export interface McpRuntimeToolDefinition {
  runtimeToolId: string;
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations?: JsonObject;
  serverId: string;
  serverName: string;
  capability: McpRuntimeToolCapability;
}
