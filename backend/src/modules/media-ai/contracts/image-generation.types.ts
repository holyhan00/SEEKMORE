import type { ResolvedUserLlmConfig } from '../../llm-settings/contracts/llm-settings.types';

export type ImageOutputSize = 'auto' | '1K' | '2K' | '4K';

export interface ImageReferenceInput {
  objectId: string;
  mimeType: string;
  buffer: Buffer;
  width?: number;
  height?: number;
}

export interface ImageGenerationRequest {
  config: ResolvedUserLlmConfig;
  prompt: string;
  references: ImageReferenceInput[];
  mask: ImageReferenceInput | null;
  count: number;
  aspectRatio: string | null;
  outputSize: ImageOutputSize;
  quality: 'standard' | 'high';
  outputFormat: 'png' | 'jpeg' | 'webp';
  signal?: AbortSignal;
}

export interface ImageProviderOutput {
  buffer: Buffer;
  mimeType: string;
}

export interface ImageProviderResult {
  images: ImageProviderOutput[];
  revisedPrompt?: string | null;
  providerMetadata?: Record<string, unknown>;
}

export interface ImageProviderAdapter {
  readonly kind: string;
  supports(config: ResolvedUserLlmConfig): boolean;
  generate(request: ImageGenerationRequest): Promise<ImageProviderResult>;
}

export interface GenerateImageInput {
  model: ResolvedUserLlmConfig;
  userId: string;
  agentId: string;
  conversationId: string;
  generationBatchId: string;
  prompt: string;
  sourceObjectIds?: string[];
  maskObjectId?: string | null;
  count?: number;
  aspectRatio?: string | null;
  outputSize?: ImageOutputSize | null;
  quality?: 'standard' | 'high';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  signal?: AbortSignal;
}
