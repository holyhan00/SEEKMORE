import type { ResolvedAudioGenerationConfig } from '../../../llm-settings/contracts/llm-settings.types';

export interface AudioBinaryOutput {
  buffer: Buffer;
  mimeType: string;
  extension: 'mp3';
  metadata?: Record<string, unknown>;
}

export interface SpeechSynthesisRequest {
  config: ResolvedAudioGenerationConfig;
  text: string;
  voiceId?: string | null;
  speed?: number;
  signal?: AbortSignal;
}

export interface VoiceCloneRequest {
  config: ResolvedAudioGenerationConfig;
  displayName: string;
  source: {
    objectId: string;
    originalName: string;
    mimeType: string;
    buffer: Buffer;
  };
  removeBackgroundNoise: boolean;
  signal?: AbortSignal;
}

export interface VoiceCloneOutput {
  externalVoiceId: string;
  requiresVerification: boolean;
  metadata?: Record<string, unknown>;
}

export interface MusicGenerationRequest {
  config: ResolvedAudioGenerationConfig;
  prompt: string;
  lyrics?: string | null;
  instrumental: boolean;
  signal?: AbortSignal;
}

export interface AudioGenerationProvider {
  readonly providerKey: string;
  synthesize(input: SpeechSynthesisRequest): Promise<AudioBinaryOutput>;
  cloneVoice(input: VoiceCloneRequest): Promise<VoiceCloneOutput>;
  generateMusic(input: MusicGenerationRequest): Promise<AudioBinaryOutput>;
}
