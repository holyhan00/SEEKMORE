                                                               

export type CognitiveCoreCapabilityKey =
  | 'chat'
  | 'writing'
  | 'planning'
  | 'research'
  | 'document'
  | 'coding'
  | 'data_analysis';

export type CognitiveInternalToolCapabilityKey =
  | 'file_reading'
  | 'file_render'
  | 'docx_generation'
  | 'xlsx_generation';

export type CognitiveExternalToolCapabilityKey =
  | 'web_search'
  | 'image_generation';

export type CognitiveCapabilityKey =
  | CognitiveCoreCapabilityKey
  | CognitiveInternalToolCapabilityKey
  | CognitiveExternalToolCapabilityKey;

export type CognitiveToolScope =
  | 'internal_object'
  | 'internal_file'
  | 'external_search'
  | 'external_generation';

export interface CognitiveCapabilityProfile {
  domains: string[];
  tools: string[];
  toolScopes: CognitiveToolScope[];

  canUseMemory: boolean;
  canUseKnowledge: boolean;
  canUseWebSearch: boolean;
  canReadObjects: boolean;

  canGenerateDocuments: boolean;
  canGenerateSpreadsheets: boolean;
  canRenderObjects: boolean;
  canGenerateImages: boolean;

  maxKnowledgeFileSizeMb: number;
}

export interface CurrentJwtUser {
  userId?: string;
  id?: string;
  sub?: string;
  email?: string;
  username?: string;
}