                                                             

export type SkillStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'ACTIVE'
  | 'DISABLED'
  | 'STALE'
  | 'ARCHIVED'
  | 'REJECTED';

export type SkillVersionStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'SUPERSEDED';

export type SkillVisibility =
  | 'PRIVATE'
  | 'ORGANIZATION'
  | 'PUBLIC';

export type SkillTrustLevel =
  | 'BUILTIN'
  | 'TRUSTED'
  | 'COMMUNITY'
  | 'USER';

export type SkillSecurityState =
  | 'CLEAR'
  | 'REVIEW_REQUIRED'
  | 'QUARANTINED'
  | 'BLOCKED';

export type EffectiveAgentSkillActivationMode =
  | 'MANUAL'
  | 'AUTOMATIC'
  | 'ALWAYS';

export type AgentSkillActivationMode =
  | 'INHERIT'
  | EffectiveAgentSkillActivationMode;

export type SkillActivationMode =
  | EffectiveAgentSkillActivationMode
  | 'DISABLED';

export type SkillVersionPolicy =
  | 'FOLLOW_CURRENT'
  | 'PINNED'
  | 'CONSTRAINT';

export type SkillFileType =
  | 'REFERENCE'
  | 'SCRIPT'
  | 'ASSET'
  | 'LICENSE'
  | 'OTHER';

export type SkillSourceKind =
  | 'BUILTIN'
  | 'REPOSITORY'
  | 'UPLOAD'
  | 'INLINE'
  | 'IMPORTED';

export type SkillSchemaKind =
  | 'INPUT'
  | 'OUTPUT'
  | 'CONFIG';

export type SkillLibraryView =
  | 'mine'
  | 'drafts'
  | 'archived'
  | 'deleted';

export type SkillListSort =
  | 'created_desc'
  | 'created_asc'
  | 'updated_desc'
  | 'updated_asc';

export type SkillDeleteBlocker = 'NOT_OWNER';

export type SkillPrincipalType =
  | 'USER'
  | 'ORGANIZATION'
  | 'TENANT'
  | 'PUBLIC';

export type SkillPermissionAction =
  | 'VIEW'
  | 'USE'
  | 'EDIT'
  | 'MANAGE'
  | 'INSTALL';

export interface SkillAclEntry {
  id?: string;
  skillId?: string;
  principalType: SkillPrincipalType;
  principalId: string;
  permissions: SkillPermissionAction[];
}

export interface SkillUsageEvent {
  id: string;
  activationMode: SkillActivationMode;
  activationSource: string;
  outcome: string;
  reason?: string | null;
  occurredAt: string;
}

export interface SkillVersionSummary {
  id: string;
  skillId: string;
  versionNumber: number;
  versionLabel: string;
  status: SkillVersionStatus;
  revision: number;
  skillMarkdown: string;
  instructionBody?: string;
  validationPolicy?: Record<
    string,
    unknown
  >;
  failurePolicy?: Record<
    string,
    unknown
  >;
  executionPolicy?: Record<
    string,
    unknown
  >;
  packageChecksum: string;
  changeLog?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  _count?: {
    files?: number;
    validationRuns?: number;
  };
}

export interface SkillSource {
  id: string;
  kind: SkillSourceKind;
  sourceRef?: string | null;
  sourceRevision?: string | null;
  checksum?: string | null;
  provenance?: Record<string, unknown>;
}

   
                
  
                    
                            
                             
  
                                      
   
export interface SkillAuthorSummary {
  id: string;
  username: string | null;
}

export interface SkillSummary {
  id: string;
  ownerUserId?: string | null;

  createdBy?: SkillAuthorSummary | null;

  name: string;
  displayName: string;
  slug: string;
  description: string;
  activationDescription?: string | null;
  status: SkillStatus;
  visibility: SkillVisibility;
  trustLevel: SkillTrustLevel;
  securityState: SkillSecurityState;
  defaultActivationMode: SkillActivationMode;
  category?: string | null;
  tags: string[];
  iconUrl?: string | null;
  coverUrl?: string | null;
  currentVersionId?: string | null;
  currentVersion?: SkillVersionSummary | null;
  source?: SkillSource | null;
  revision: number;
  useCount: string | number;
  lastUsedAt?: string | null;
  lastValidatedAt?: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  purgeAfter?: string | null;
  diagnostics?: SkillDocumentDiagnostic[];
  validation?: SkillValidationSummary;
  creationMethod?: SkillCreationMethod;
  _count?: {
    versions?: number;
    agentBindings?: number;
    installations?: number;
    usageEvents?: number;
  };
}

export interface SkillDetail
  extends SkillSummary {
  versions: SkillVersionSummary[];
  viewerCanManage?: boolean;
  viewerIsOwner?: boolean;
  viewerCanDelete?: boolean;
  viewerCanRestoreDeleted?: boolean;
  viewerDeleteBlockers?: SkillDeleteBlocker[];
  viewerInstallation?: {
    id: string;
    status: string;
    enabled: boolean;
    removedAt?: string | null;
  } | null;
}

export interface SkillListParams {
  search?: string;
  scope?: SkillLibraryView;
  status?: SkillStatus;
  limit?: number;
  offset?: number;
  sort?: SkillListSort;
  [key: string]:
    | string
    | number
    | boolean
    | undefined;
}

export interface SkillListResponse {
  items: SkillSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface SkillFileRecord {
  id: string;
  skillVersionId: string;
  path: string;
  fileType: SkillFileType;
  mimeType: string;
  checksum: string;
  sizeBytes: string | number;
  executable: boolean;
  createdAt: string;
}

export interface SkillFileTreeDirectoryNode {
  kind: 'directory';
  name: string;
  path: string;
  children: SkillFileTreeNode[];
}

export interface SkillFileTreeFileNode {
  kind: 'file';
  name: string;
  path: string;
  file: SkillFileRecord;
}

export type SkillFileTreeNode =
  | SkillFileTreeDirectoryNode
  | SkillFileTreeFileNode;

export interface SkillFileUploadEntry {
  file: File;
  path: string;
  fileType?: SkillFileType;
}

export interface SkillDependencyInput {
  key: string;
  versionConstraint?: string | null;
  required?: boolean;
  reason?: string | null;
}

export interface SkillDependenciesResponse {
  skillDependencies: Array<{
    dependencySkillId: string;
    versionConstraint?: string | null;
    required: boolean;
    reason?: string | null;
  }>;

  toolDependencies: Array<{
    toolName: string;
    versionConstraint?: string | null;
    required: boolean;
  }>;

  mcpDependencies: Array<{
    serverName: string;
    toolName?: string | null;
    required: boolean;
  }>;
}

export interface SkillSchemaRecord {
  id: string;
  kind: SkillSchemaKind;
  schema: Record<string, unknown>;
}

export interface AgentSkillBindingInput {
  skillId: string;
  activationMode: AgentSkillActivationMode;
  priority: number;
  enabled: boolean;
  versionPolicy: SkillVersionPolicy;
  versionConstraint: string | null;
  pinnedVersionId: string | null;
  config: Record<string, unknown>;
  permissionOverrides: Record<
    string,
    unknown
  >;
}

export interface AgentSkillPolicy {
  id?: string;
  agentId?: string;
  defaultActivationMode: EffectiveAgentSkillActivationMode;
  maxCatalogEntries: number;
  catalogCharBudget: number;
  instructionTokenBudget: number;
  resourceTokenBudget: number;
  maxAutomaticSkills: number;
  maxResourceFiles: number;
  revision: number;
}

export interface AgentSkillBindingRecord
  extends AgentSkillBindingInput {
  id: string;
  effectiveActivationMode: EffectiveAgentSkillActivationMode;
  cognitiveAgentId: string;
  skill: SkillSummary;
  pinnedVersion?: SkillVersionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSkillBindingsResponse {
  policy: AgentSkillPolicy | null;
  bindings: AgentSkillBindingRecord[];
}

export interface SkillEditorDraft {
  displayName?: string;
  skillMarkdown: string;
}

export type SkillCreationMethod =
  | 'USER_AUTHORED'
  | 'AI_GENERATED'
  | 'IMPORTED';

export type SkillDiagnosticSeverity =
  | 'INFO'
  | 'WARNING'
  | 'ERROR'
  | 'CRITICAL';

export interface SkillDocumentDiagnostic {
  code: string;
  severity: SkillDiagnosticSeverity;
  message: string;
  params?: Record<string, string | number | boolean | null>;
  path: string | null;
  field?: string | null;
  line?: number | null;
  column?: number | null;
}

export type SkillValidationMode =
  | 'STRICT'
  | 'COMPATIBLE'
  | 'IMPORT_COMPATIBLE';

export interface SkillValidationSummary {
  parseable: boolean;
  safe: boolean;
  runnable: boolean;
  specCompliant: boolean;
  accepted: boolean;
  mode: SkillValidationMode;
  diagnostics: SkillDocumentDiagnostic[];
}

export interface SkillGenerationInput {
  displayName: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  agentId?: string;
}

export interface SkillGenerationResult {
  displayName: string;
  internalName: string;
  skillMarkdown: string;
  diagnostics: SkillDocumentDiagnostic[];
  validation: SkillValidationSummary;
  generationAttempts: number;
}

export interface SkillImportFileSummary {
  path: string;
  mimeType: string;
  sizeBytes: number;
  fileType: SkillFileType;
  executable: boolean;
}

export interface SkillImportInspection {
  inspectionToken: string;
  sourceKind: SkillSourceKind;
  sourceRef: string | null;
  sourceRevision: string | null;
  detectedFormat: 'SKILL_MD' | 'ZIP' | 'GITHUB';
  rootName: string;
  name: string;
  displayName: string;
  description: string;
  skillMarkdown: string;
  files: SkillImportFileSummary[];
  diagnostics: SkillDocumentDiagnostic[];
  validation: SkillValidationSummary;
  security: {
    passed: boolean;
    diagnostics: SkillDocumentDiagnostic[];
  };
  notes: string[];
}

export interface SkillImportInspectResult {
  inspection: SkillImportInspection;
}

export interface SkillImportSourceInput {
  file?: File | null;
  repositoryUrl?: string;
  content?: string;
}

export interface SkillFileRevisionResult {
  version: SkillVersionSummary;
  file?: SkillFileRecord;
}

export interface SkillFileBatchRevisionResult {
  version: SkillVersionSummary;
  files?: SkillFileRecord[];
  removedFileIds?: string[];
}

export interface SkillDeleteResult {
  id: string;
  deletedAt: string;
  purgeAfter: string;
}

export interface SkillPermanentDeleteResult {
  id: string;
  permanentlyDeleted: true;
  removedStorageObjects: number;
}

export interface SkillCapabilityCatalogItem {
  id: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  confirmationRequired: boolean;
  supported: boolean;
  available: boolean;
  generationEligible: boolean;
  providerToolIds: string[];
}

export interface SkillCapabilityCatalogResponse {
  revision: string;
  items: SkillCapabilityCatalogItem[];
}
