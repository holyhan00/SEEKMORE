import type {
  McpCatalogAvailability,
  McpCatalogCategory,
} from './mcp-catalog-taxonomy';

export type BuiltinMcpTransport = 'stdio' | 'streamable_http';
export type BuiltinMcpManagedRuntime = 'DESKTOP' | 'BACKEND_INTERNAL' | 'REMOTE';
export type BuiltinMcpVisibility = 'PUBLIC' | 'PRIVATE';

export interface BuiltinDesktopSetup {
  kind: string;
  releaseKey: string;
  [key: string]: unknown;
}

export interface BuiltinMcpRelease {
  integrationVersion: string;
  serverPackage?: {
    ecosystem: 'pypi' | 'npm' | 'remote';
    name: string;
    version: string;
    sha256?: string;
  };
  updatePolicy: 'manual_review';
}

export interface BuiltinMcpDefinition {
  stableKey: string;
  name: string;
  displayName: string;
  productIntroduction: string;
  description: string;
  publisher: string;
  iconKey: string;
  category: McpCatalogCategory;
  tags: string[];
  availability: McpCatalogAvailability;
  featured: boolean;
  sortOrder: number;
  release?: BuiltinMcpRelease;
  visibility: BuiltinMcpVisibility;
  originType: 'SYSTEM_SEED';
  managedRuntime: BuiltinMcpManagedRuntime;
  transport: BuiltinMcpTransport;
  endpoint?: string;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  authKind?: 'none' | 'bearer' | 'api_key' | 'custom_headers' | 'environment' | 'oauth2';
  authConfig?: Record<string, unknown>;
  repository?: string;
  registryIdentifier?: string;
  registryVersion?: string;
  protocolPreference?: 'auto' | 'legacy' | 'modern';
  trustLevel: 'public' | 'workspace' | 'internal';
  scope?: 'app';
  allowedDomains?: string[];
  deniedDomains?: string[];
  allowedRoles?: string[];
  allowedToolNames?: string[];
  deniedToolNames?: string[];
  toolPolicy?: Record<string, unknown>;
  requestScoped?: boolean;
  timeoutMs?: number;
  enabled?: boolean;
  desktopSetup?: BuiltinDesktopSetup;
}

export interface BuiltinMcpCatalogSyncResult {
  stableKey: string;
  name: string;
  serverId: string;
  created: boolean;
  updated: boolean;
}
