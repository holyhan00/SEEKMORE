export type VideoAudioPreference = 'auto' | 'required' | 'silent';

export type VideoProviderKey =
  | 'google'
  | 'minimax'
  | 'doubao'
  | 'vidu'
  | 'zhipu'
  | 'hunyuan'
  | 'qwen';

export type VideoReferenceRole =
  | 'first_frame'
  | 'last_frame'
  | 'subject'
  | 'style'
  | 'reference'
  | 'reference_video';

export interface VideoReferenceDescriptor {
  objectId: string;
  role: VideoReferenceRole;
}

export interface PreparedVideoImageReference extends VideoReferenceDescriptor {
  mediaType: 'image';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  buffer: Buffer;
  width: number;
  height: number;
}

export interface PreparedVideoVideoReference extends VideoReferenceDescriptor {
  mediaType: 'video';
  role: 'reference_video';
  mimeType: 'video/mp4';
  buffer: Buffer;
}

export type PreparedVideoReference =
  | PreparedVideoImageReference
  | PreparedVideoVideoReference;

export interface VideoGenerateInput {
  userId: string;
  agentId: string;
  conversationId: string;
  prompt: string;
  references: VideoReferenceDescriptor[];
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  resolution?: string | null;
  audio?: VideoAudioPreference;
  signal?: AbortSignal;
}

export interface VideoProviderCredential {
  providerKey: VideoProviderKey;
  apiKey: string;
}

export interface VideoProviderRequest {
  prompt: string;
  references: PreparedVideoReference[];
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  resolution?: string | null;
  audio: VideoAudioPreference;
  model?: string | null;
  signal?: AbortSignal;
}

export interface VideoProviderExecutionRequest extends VideoProviderRequest {
  credential: VideoProviderCredential;
}

export interface VideoProviderOutput {
  buffer: Buffer;
  mimeType: 'video/mp4';
  extension: 'mp4';
  providerKey: VideoProviderKey;
  model: string;
  metadata?: Record<string, unknown>;
}

export interface VideoProviderAdapter {
  readonly providerKey: VideoProviderKey;
  supports(request: VideoProviderRequest): boolean;
  generate(request: VideoProviderExecutionRequest): Promise<VideoProviderOutput>;
}

export interface ResolvedVideoProvider {
  credential: VideoProviderCredential;
  adapter: VideoProviderAdapter;
}

export interface VideoGenerationModelCapabilities {
  textToVideo: boolean;
  imageToVideo: boolean;
  firstLastFrame: boolean;
  referenceImages: boolean;
  generatedAudio: boolean;
  referenceVideo?: boolean;
  silentOutput?: boolean;
  durationSeconds?: readonly number[] | { minimum: number; maximum: number };
  resolutions?: readonly string[];
  aspectRatios?: readonly string[];
  maximumReferenceImages?: number;
  maximumReferenceVideos?: number;
}

export interface VideoGenerationCatalogModel {
  modelKey: string;
  displayName: string;
  recommended: boolean;
  enabled: boolean;
  capabilities: VideoGenerationModelCapabilities;
}

export interface VideoGenerationProviderDefinition {
  providerKey: VideoProviderKey;
  displayName: string;
  baseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
  enabled: boolean;
  sortOrder: number;
  models: readonly VideoGenerationCatalogModel[];
}

export interface VideoGenerationAvailability {
  status: 'available' | 'unavailable';
  providerKeys: VideoProviderKey[];
  reasonCode?: string;
}
