import type { Prisma, RuntimeObject } from '@prisma/client';

export type ObjectKind =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'html'
  | 'markdown'
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'code'
  | 'binary'
  | 'unknown';

export type ObjectCatalogStatus = 'available' | 'failed' | 'deleted';

export type RuntimeObjectOriginType = 'user_upload' | 'runtime_generated';
export type RuntimeObjectVisibility = 'user_visible' | 'internal';

export interface ObjectPartition {
  userId: string;
  agentId: string;
  conversationId: string;
}

export interface RuntimeObjectUploadInput extends ObjectPartition {
  object: Express.Multer.File;
  metadata?: Prisma.InputJsonValue;
}


export interface RuntimeGeneratedObjectInput extends ObjectPartition {
  originalName: string;
  mimeType?: string | null;
  buffer: Buffer;
  metadata?: Prisma.InputJsonValue;
  visibility?: RuntimeObjectVisibility;
  preview?: {
    kind: string;
    mimeType: string;
    extension: string;
    buffer: Buffer;
  };
}

export interface RuntimeObjectCreateInput extends ObjectPartition {
  id: string;
  originalName: string;
  displayName: string;
  baseName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  duplicateGroupKey: string;
  versionNo: number;
  storageKey: string;
  objectKind: ObjectKind;
  originType: RuntimeObjectOriginType;
  visibility: RuntimeObjectVisibility;
  status: ObjectCatalogStatus;
  metadata?: Prisma.InputJsonValue;
}

export interface ObjectSearchInput extends ObjectPartition {
  objectIds?: string[] | null;
  query?: string | null;
  objectKind?: ObjectKind | null;
  originType?: RuntimeObjectOriginType | null;
  extension?: string | null;
  cursor?: string | null;
  limit?: number | null;
}

export interface ObjectSearchResult {
  objects: RuntimeObject[];
  nextCursor: string | null;
}

export interface ObjectCatalogCard {
  objectId: string;
  agentId: string;
  conversationId: string;
  originalName: string;
  displayName: string;
  objectKind: string;
  originType: string;
  visibility: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  versionNo: number;
  status: string;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
  processingStatus: 'ready' | 'unsupported';
  capabilities: string[];
  contentSummary: string | null;
  generationIntent: string | null;
  processor: string | null;
  processorVersion: string | null;
  previewUrl: string | null;
  sourceTool?: string;
  generationBatchId?: string;
  generationIndex?: number;
  media: {
    width?: number;
    height?: number;
    format?: string;
    hasAlpha?: boolean;
    durationMs?: number;
    sampleRate?: number;
    channels?: number;
    bitrate?: number;
    codec?: string;
  } | null;
  readyForMessageInput: boolean;
}

export type RuntimeObjectRecord = RuntimeObject;
