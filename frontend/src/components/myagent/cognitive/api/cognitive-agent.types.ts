export type CognitiveAgentLibraryView = 'active' | 'deleted';
export type KnowledgeParseStatus = 'PENDING' | 'PARSING' | 'READY' | 'FAILED';
export type KnowledgeAssetRole = 'content_material';
export type RuntimeObjectKind = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'zip';

export interface CognitiveAgentKnowledgeMeta {
  objectRole?: KnowledgeAssetRole;
  objectKind?: RuntimeObjectKind;
  parsedKind?: string;
  parsedAt?: string;
  [key: string]: unknown;
}

export interface CognitiveAgentKnowledgeFile {
  id: string;
  originalName: string;
  storedName?: string;
  mimeType: string;
  extension?: string | null;
  sizeBytes: number;
  sha256?: string | null;
  storageKey?: string;
  parseStatus: KnowledgeParseStatus;
  parseError?: string | null;
  chunkCount?: number | null;
  embeddingModel?: string | null;
  meta?: CognitiveAgentKnowledgeMeta | null;
  createdAt: string;
  updatedAt?: string;
  _count?: { chunks?: number };
}

export interface CognitiveAgentKnowledgeFileSpec {
  fileIndex: number;
  originalName: string;
  name?: string;
  description?: string;
  objectRole: 'content_material';
  objectKind: RuntimeObjectKind;
  sortOrder?: number;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface CognitiveAgent {
  id: string;
  key?: string | null;
  name: string;
  description?: string | null;
  rolePrompt?: string | null;
  systemPrompt?: string | null;
  avatarKey?: string | null;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | Date | null;
  coverKey?: string | null;
  coverUrl?: string | null;
  coverUpdatedAt?: string | Date | null;
  entityType?: 'COGNITIVE' | 'SERVICE';
  visibility?: string | null;
  isActive?: boolean;
  deletedAt?: string | null;
  purgeAfter?: string | null;
  conversationCount?: number;
  messageCount?: number;
  capabilities?: string[];
  accessLevel?: string | null;
  remark?: string | null;
  pinnedAt?: string | number | null;
  isDefaultAgent?: boolean;
  isSuper?: boolean;
  knowledgeEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
  knowledgeFiles?: CognitiveAgentKnowledgeFile[];
  knowledgeObjects?: CognitiveAgentKnowledgeFile[];
  knowledgeFileCount?: number;
}

export interface CreateCognitiveAgentPayload {
  name: string;
  description?: string;
  rolePrompt: string;
  avatarFile?: File | null;
  coverFile?: File | null;
  capabilities?: string[];
  knowledgeFiles: File[];
  knowledgeFileSpecs?: CognitiveAgentKnowledgeFileSpec[];
}

export interface UpdateCognitiveAgentPayload {
  name: string;
  description?: string;
  rolePrompt: string;
  avatarFile?: File | null;
  coverFile?: File | null;
  knowledgeFiles?: File[];
  knowledgeFileSpecs?: CognitiveAgentKnowledgeFileSpec[];
  capabilities?: string[];
}

export interface CognitiveAgentKnowledgeUploadPayload {
  files: File[];
  specs: CognitiveAgentKnowledgeFileSpec[];
}

export interface CognitiveAgentValidationIssue {
  level: 'error' | 'warning';
  code: string;
  params?: Record<string, string | number | boolean | null>;
}

export interface CognitiveAgentValidationResult {
  agentId: string;
  passed: boolean;
  errorCount: number;
  warningCount: number;
  issues: CognitiveAgentValidationIssue[];
}
