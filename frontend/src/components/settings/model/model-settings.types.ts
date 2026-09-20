export type LlmCredentialStatus =
  | 'UNVERIFIED'
  | 'VALID'
  | 'INVALID'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE';

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

export type LlmModelRole = 'primary' | 'vision' | 'image_generation';
export type AiSelectionRole =
  | LlmModelRole
  | 'video_generation'
  | 'audio_generation';

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
  models: LlmCatalogModel[];
}

export interface VideoGenerationModelCapabilities {
  textToVideo: boolean;
  imageToVideo: boolean;
  firstLastFrame: boolean;
  referenceImages: boolean;
  generatedAudio: boolean;
}

export interface VideoGenerationCatalogModel {
  modelKey: string;
  displayName: string;
  recommended: boolean;
  enabled: boolean;
  capabilities: VideoGenerationModelCapabilities;
}

export interface VideoGenerationCatalogProvider {
  providerKey: string;
  displayName: string;
  baseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
  enabled: boolean;
  sortOrder: number;
  models: VideoGenerationCatalogModel[];
}

export type AudioCapabilityAccess =
  | 'available'
  | 'plan_dependent'
  | 'paid_only';

export interface AudioGenerationCatalogProvider {
  providerKey: string;
  displayName: string;
  baseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
  enabled: boolean;
  sortOrder: number;
  speechModelKey: string;
  musicModelKey: string;
  capabilities: {
    speechGeneration: boolean;
    voiceCloning: boolean;
    musicGeneration: boolean;
    access?: {
      speechGeneration: AudioCapabilityAccess;
      voiceCloning: AudioCapabilityAccess;
      musicGeneration: AudioCapabilityAccess;
    };
  };
}

export interface LlmCatalogResponse {
  providers: LlmCatalogProvider[];
  videoProviders: VideoGenerationCatalogProvider[];
  audioProviders: AudioGenerationCatalogProvider[];
}

export interface UserLlmCredentialSummary {
  providerKey: string;
  configured: boolean;
  keyHint: string | null;
  status: LlmCredentialStatus | null;
  verifiedAt: string | null;
  lastValidationCode: string | null;
}

export interface UserModelRoleSettings {
  providerKey: string | null;
  modelKey: string | null;
  capabilities: ModelCapabilities | null;
  credential: Omit<UserLlmCredentialSummary, 'providerKey'>;
}

export interface UserVideoGenerationSettings {
  providerKey: string | null;
  modelKey: string | null;
  capabilities: VideoGenerationModelCapabilities | null;
  credential: Omit<UserLlmCredentialSummary, 'providerKey'>;
}

export interface UserAudioGenerationSettings {
  providerKey: string | null;
  capabilities: AudioGenerationCatalogProvider['capabilities'] | null;
  speechModelKey: string | null;
  musicModelKey: string | null;
  credential: Omit<UserLlmCredentialSummary, 'providerKey'>;
}

export interface UserLlmSettings {
  primary: UserModelRoleSettings;
  vision: UserModelRoleSettings;
  imageGeneration: UserModelRoleSettings;
  videoGeneration: UserVideoGenerationSettings;
  audioGeneration: UserAudioGenerationSettings;
  primarySupportsImageInput: boolean;
  credentials: UserLlmCredentialSummary[];
}

export interface WebSearchCatalogProvider {
  providerKey: string;
  displayName: string;
  baseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
  enabled: boolean;
}

export interface WebSearchCatalogResponse {
  providers: WebSearchCatalogProvider[];
}

export interface UserWebSearchSettings {
  providerKey: string | null;
  credential: {
    configured: boolean;
    keyHint: string | null;
    status: LlmCredentialStatus | null;
    verifiedAt: string | null;
    lastValidationCode: string | null;
  };
}
