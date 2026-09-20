export type ExploreCategory = 'AGENT' | 'SKILL';
export type McpCatalogCategory =
  | 'general'
  | 'design'
  | 'development'
  | 'collaboration'
  | 'cloud-data'
  | 'commerce-automation';

export type McpCatalogAvailability =
  | 'ready'
  | 'oauth'
  | 'credential'
  | 'local_setup';

export type ExploreTab = 'OVERVIEW' | ExploreCategory;

export type McpExploreActionState =
  | 'INSTALL'
  | 'CONFIGURE'
  | 'RECONFIGURE'
  | 'AUTHORIZE'
  | 'SETUP'
  | 'CONNECT'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECT'
  | 'DISABLED';

export interface ExploreAgentItem {
  resourceType: 'AGENT';
  id: string;
  name: string;
  description: string;
  avatarKey?: string | null;
  coverKey?: string | null;
  tags: string[];
  visibility: 'PUBLIC_FREE' | 'PUBLIC_PAID';
  installed: boolean;
  actionState: 'ADD' | 'AUTHORIZE' | 'ADDED';
  downloads: number;
}

export interface ExploreSkillItem {
  resourceType: 'SKILL';
  id: string;
  name: string;
  description: string;
  iconKey?: string | null;
  coverKey?: string | null;
  tags: string[];
  category?: string | null;
  installed: boolean;
  actionState: 'INSTALL' | 'INSTALLED';
  useCount: string;
}

export interface ExploreMcpItem {
  resourceType: 'MCP';
  id: string;
  stableKey?: string | null;
  name: string;
  productIntroduction: string;
  description: string;
  publisher?: string | null;
  iconKey?: string | null;
  source: 'SYSTEM' | 'USER';
  transport: 'stdio' | 'streamable_http';
  authKind: string;
  official: boolean;
  category: McpCatalogCategory;
  tags: string[];
  availability: McpCatalogAvailability;
  configurationState?: string | null;
  configurationHint: string;
  configurationHintPresentation?: { key: string; params?: Record<string, string> } | null;
  requiredConfigurationKeys: string[];
  featured: boolean;
  sortOrder: number;
  installed: boolean;
  installationId?: string | null;
  connectionStatus: string;
  toolCount: number;
  actionState: McpExploreActionState;
}

export type ExploreResourceItem =
  | ExploreAgentItem
  | ExploreSkillItem
  | ExploreMcpItem;
