
export type McpManagementAction = 'configure' | 'setup';

export interface McpManagementRequest {
  installationId: string;
  action: McpManagementAction;
  requestId: number;
}

export type McpTransport = 'stdio' | 'streamable_http';

export interface McpDefinitionDetail {
  id: string;
  stableKey?: string | null;
  source: 'SYSTEM' | 'USER';
  ownerUserId?: string | null;
  displayName: string;
  name: string;
  description: string;
  publisher?: string | null;
  iconKey?: string | null;
  transport: McpTransport;
  authKind: 'none' | 'bearer' | 'api_key' | 'custom_headers' | 'environment' | 'oauth2';
  managedRuntime: 'DESKTOP' | 'REMOTE' | 'BACKEND_INTERNAL';
  status: string;
  endpoint?: string | null;
  command?: string | null;
  args?: string[];
  workingDirectory?: string | null;
  timeoutMs?: number;
  declaredHeaderKeys: string[];
  declaredEnvironmentKeys: string[];
}

export interface McpInstallationItem {
  id: string;
  installationId: string;
  serverId: string;
  stableKey?: string | null;
  enabled: boolean;
  status: string;
  configurationState: string;
  installedAt: string;
  source: 'SYSTEM' | 'USER';
  owned: boolean;
  displayName: string;
  name: string;
  description: string;
  publisher?: string | null;
  iconKey?: string | null;
  transport: McpTransport;
  authKind: string;
  availability: 'ready' | 'oauth' | 'credential' | 'local_setup';
  configurationHint: string;
  configurationHintPresentation?: { key: string; params?: Record<string, string> } | null;
  requiredConfigurationKeys: string[];
  declaredHeaderKeys: string[];
  declaredEnvironmentKeys: string[];
  connectionStatus: string;
  connectionFailureCode?: string | null;
  connectionFailureMessage?: string | null;
  protocolEra?: string | null;
  protocolVersion?: string | null;
  toolCount: number;
  credential?: { kind: string; maskedHint?: string | null; storageLocation: string } | null;
  oauthStatus?: 'not_required' | 'authorization_required' | 'authorized' | 'expired' | 'revoked';
  oauthExpiresAt?: string | null;
  actionState:
    | 'DISABLED'
    | 'AUTHORIZE'
    | 'CONFIGURE'
    | 'RECONFIGURE'
    | 'SETUP'
    | 'CONNECT'
    | 'CONNECTING'
    | 'CONNECTED'
    | 'RECONNECT';
}

export interface McpToolItem {
  id: string;
  runtimeToolId: string;
  toolName: string;
  title?: string | null;
  description?: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  annotations?: Record<string, unknown> | null;
  status: string;
  discoveredAt: string;
}


export interface McpDefinitionDraft {
  displayName: string;
  description: string;
  transport: McpTransport;
  endpoint: string;
  command: string;
  argsText: string;
  workingDirectory: string;
  authKind: McpDefinitionDetail['authKind'];
  headersText: string;
  environmentText: string;
  timeoutMs: number;
}
