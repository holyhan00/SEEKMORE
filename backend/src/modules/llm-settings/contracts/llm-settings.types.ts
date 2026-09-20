import type { LlmCredentialStatus } from '@prisma/client';

export type LlmProviderProtocol =
  | 'openai_chat'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'gemini_generate_content'
  | 'openai_images'
  | 'gemini_image'
  | 'gemini_interactions_image'
  | 'xai_images'
  | 'dashscope_multimodal_image'
  | 'ark_images';

export type LlmModelRole =
  | 'primary'
  | 'vision'
  | 'image_generation';

export type AiSelectionRole =
  | LlmModelRole
  | 'video_generation'
  | 'audio_generation';


export type EffectiveMediaCapability =
  | 'vision'
  | 'image_generation'
  | 'speech_generation'
  | 'music_generation'
  | 'voice_cloning';

export type EffectiveMediaRoute =
  | {
      status: 'available';
      capability: EffectiveMediaCapability;
      source: 'configured' | 'primary';
      providerKey: string;
      modelKey: string | null;
      selectionRole: 'primary' | 'vision' | 'image_generation' | 'audio_generation';
    }
  | {
      status: 'unavailable';
      capability: EffectiveMediaCapability;
      source: 'none';
      reasonCode: string;
    };

export interface EffectiveMediaRoutes {
  version: number;
  resolvedAt: string;
  vision: EffectiveMediaRoute;
  imageGeneration: EffectiveMediaRoute;
  speechGeneration: EffectiveMediaRoute;
  musicGeneration: EffectiveMediaRoute;
  voiceCloning: EffectiveMediaRoute;
}

export interface ModelCapabilities {
  textInput: boolean;
  imageInput: boolean;
  textOutput: boolean;
  imageOutput: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  temperature: boolean;
  imageEditing?: boolean;
  imageMaskEditing?: boolean;
  multipleImageInput?: boolean;
  maximumInputImages?: number;
  imageOutputSizes?: readonly string[];
  defaultImageOutputSize?: string;
  highImageOutputSize?: string;
  speechGeneration?: boolean;
  voiceCloning?: boolean;
  musicGeneration?: boolean;
}

export interface LlmCatalogModel {
  modelKey: string;
  displayName: string;
  apiMode: string;
  protocol?: LlmProviderProtocol;
  baseUrl?: string;
  roles: LlmModelRole[];
  capabilities: ModelCapabilities;
  recommended: boolean;
  enabled: boolean;
}

export interface LlmCatalogProvider {
  providerKey: string;
  displayName: string;
  protocol: LlmProviderProtocol;
  baseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
  enabled: boolean;
  sortOrder: number;
  models: readonly LlmCatalogModel[];
}

export interface EncryptedLlmCredential {
  encryptedApiKey: Buffer;
  encryptionIv: Buffer;
  encryptionAuthTag: Buffer;
  encryptionVersion: number;
}

export interface LlmCredentialValidationResult {
  status: LlmCredentialStatus;
  code: string;
  verifiedAt: Date | null;
}

export interface ResolvedUserLlmConfig {
  provider: string;
  providerKey: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  apiMode: string;
  protocol: LlmProviderProtocol;
  headers?: Record<string, string>;
  capabilities: ModelCapabilities;

                                                           
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
}

export interface OptionalResolvedModel {
  configured: boolean;
  config: ResolvedUserLlmConfig | null;
  reasonCode: string | null;
}


export type AudioCapabilityAccess =
  | 'available'
  | 'plan_dependent'
  | 'paid_only';

export interface AudioGenerationProviderCapabilities {
  speechGeneration: boolean;
  voiceCloning: boolean;
  musicGeneration: boolean;
  access?: {
    speechGeneration: AudioCapabilityAccess;
    voiceCloning: AudioCapabilityAccess;
    musicGeneration: AudioCapabilityAccess;
  };
}

export interface AudioGenerationProviderDefinition {
  providerKey: string;
  displayName: string;
  baseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
  enabled: boolean;
  sortOrder: number;
  speechModelKey: string;
  speechModelKeys?: readonly string[];
  musicModelKey: string;
  musicModelKeys?: readonly string[];
  defaultVoiceId?: string;
  capabilities: AudioGenerationProviderCapabilities;
}

export interface ResolvedAudioGenerationConfig {
  providerKey: string;
  provider: AudioGenerationProviderDefinition;
  baseUrl: string;
  apiKey: string;
  speechModelKey: string;
  musicModelKey: string;
}

export interface OptionalResolvedAudioGeneration {
  configured: boolean;
  config: ResolvedAudioGenerationConfig | null;
  reasonCode: string | null;
}
