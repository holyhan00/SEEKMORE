import type { SkillDocumentFrontmatter, SkillDocumentDiagnostic } from './skill-document.types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type EffectiveAgentSkillActivationMode = 'MANUAL' | 'AUTOMATIC' | 'ALWAYS';
export type AgentSkillActivationMode = 'INHERIT' | EffectiveAgentSkillActivationMode;
export type SkillActivationMode = EffectiveAgentSkillActivationMode | 'DISABLED';
export type SkillVersionPolicy = 'FOLLOW_CURRENT' | 'PINNED' | 'CONSTRAINT';
export type SkillCatalogSource = 'AGENT_BINDING' | 'SESSION' | 'USER_EXPLICIT' | 'DISCOVERABLE';

                                                                                  
export interface SkillCatalogEntry {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  description: string;
  versionId: string;
  version: string;
  activationMode: SkillActivationMode;
  source: SkillCatalogSource;
  priority: number;
  relevance: number;
  trustLevel: 'BUILTIN' | 'TRUSTED' | 'COMMUNITY' | 'USER';
  category: string | null;
  tags: string[];
  estimatedTokens: number;
  exclusiveGroup: string | null;
  conflictKeys: string[];
}

                                                           
export interface SkillDiscoveryEntry {
  name: string;
  displayName: string;
  description: string;
}

export type SkillManifest = SkillDocumentFrontmatter;

export interface SkillDependencyItemStatus {
  kind: 'SKILL' | 'TOOL' | 'MCP';
  key: string;
  required: boolean;
  available: boolean;
  permitted: boolean;
  reason: string | null;
}

export interface SkillDependencyStatus {
  satisfied: boolean;
  items: SkillDependencyItemStatus[];
}

export interface LoadedSkillFile {
  id: string;
  path: string;
  type: 'REFERENCE' | 'SCRIPT' | 'ASSET' | 'LICENSE' | 'OTHER';
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  executable: boolean;
  contentAvailable: boolean;
}


export interface ActivatedSkillDocument {
  name: string;
  displayName: string;
  description: string;
  skillMarkdown: string;
  resources: LoadedSkillFile[];
}

export interface SkillActivationDecision {
  selectedSkillIds: string[];
  reason: string;
  confidence: number;
  activationMode: SkillActivationMode | null;
  dependencyStatus: SkillDependencyStatus | null;
  rejectedSkills: Array<{ skillId: string; code: string; reason: string }>;
  tokenEstimate: number;
}

export interface ResolvedSkill {
  skillId: string;
  versionId: string;
  version: string;
  activationMode: SkillActivationMode;
  source: SkillCatalogSource;
  priority: number;
  reason: string;
  confidence: number;
}

export interface LoadedSkill {
  skillId: string;
  versionId: string;
  version: string;
  name: string;
  displayName: string;
  slug: string;
  description: string;
  skillMarkdown: string;
  instructions: string;
  manifest: SkillManifest;
  files: LoadedSkillFile[];
  references: LoadedSkillFile[];
  scripts: LoadedSkillFile[];
  assets: LoadedSkillFile[];
  inputSchema: JsonObject | null;
  outputSchema: JsonObject | null;
  configSchema: JsonObject | null;
  validationPolicy: JsonObject;
  failurePolicy: JsonObject;
  permissions: JsonObject;
  dependencies: SkillDependencyStatus;
  checksum: string;
  activationMode: SkillActivationMode;
  source: SkillCatalogSource;
}

export interface SkillRuntimePolicy {
  maxCatalogEntries: number;
  catalogCharBudget: number;
  instructionTokenBudget: number;
  resourceTokenBudget: number;
  maxAutomaticSkills: number;
  maxResourceFiles: number;
  publicDiscoveryEnabled: boolean;
  publicCatalogLimit: number;
}

export interface SkillTurnPreparedContext {
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
                                                         
  catalog: SkillDiscoveryEntry[];
                                                                              
  internalCatalog: SkillCatalogEntry[];
  preloadedSkills: ActivatedSkillDocument[];
  explicitSkillIds: string[];
  policy: SkillRuntimePolicy;
}

export interface SkillRuntimeSession extends SkillTurnPreparedContext {
  allowedVersions: Map<string, string>;
  allowedSkillIdsByName: Map<string, string>;
  loadedVersions: Set<string>;
  resourceReads: number;
  resourceTokens: number;
  automaticLoads: number;
}

export interface SkillValidationIssue extends SkillDocumentDiagnostic {}

export interface SkillValidationResult {
  valid: boolean;
  packageChecksum: string;
  structuralIssues: SkillValidationIssue[];
  securityIssues: SkillValidationIssue[];
  dependencyIssues: SkillValidationIssue[];
  capabilityIssues: SkillValidationIssue[];
}

export interface AgentSkillBindingInput {
  skillId: string;
  activationMode: AgentSkillActivationMode;
  priority: number;
  enabled: boolean;
  versionPolicy: SkillVersionPolicy;
  versionConstraint: string | null;
  pinnedVersionId: string | null;
  config: JsonObject;
  permissionOverrides: JsonObject;
}
