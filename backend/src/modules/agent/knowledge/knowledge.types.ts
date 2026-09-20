                                                         

export type KnowledgeChunkKind =
  | 'text'
  | 'section'
  | 'table'
  | 'table_row';

export type KnowledgeAssetRole = 'content_material';

export type RuntimeObjectKind =
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'pdf'
  | 'zip';

export interface KnowledgeChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  kind: KnowledgeChunkKind;
  meta?: Record<string, unknown>;
}

export interface KnowledgeSearchOptions {
  agentId: string;
  userId: string;
  query: string;
  limit?: number;
  maxChars?: number;
}

export interface KnowledgeSearchHit {
  chunkId: string;
  objectId: string;
  chunkIndex: number;
  content: string;
  tokenCount?: number | null;
  sourceName?: string | null;
  meta?: unknown;
  score: number;
  vectorSimilarity?: number;
  lexicalScore?: number;
  retrievalSources: Array<'vector' | 'lexical'>;
  truncated?: boolean;
}

export interface KnowledgeIngestResult {
  objectId: string;
  chunkCount: number;
  embeddedChunkCount: number;
  embeddingEnabled: boolean;
  embeddingModel: string | null;
  embeddingDimension: number | null;
}

export interface KnowledgeBatchIngestResult {
  ingested: KnowledgeIngestResult[];
  failed: Array<{
    objectId: string;
    error: string;
  }>;
}

export interface KnowledgeFileUploadSpec {
  fileIndex: number;
  originalName: string;
  name?: string;
  description?: string;
  objectRole: KnowledgeAssetRole;
  objectKind: RuntimeObjectKind;
  isDefault?: boolean;
  sortOrder?: number;
  tags?: string[];
  meta?: Record<string, unknown>;
}
