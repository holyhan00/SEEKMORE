import { Injectable } from '@nestjs/common';
import type { ResolvedAudioGenerationConfig } from '../../llm-settings/contracts/llm-settings.types';
import type { AudioGenerationProvider } from './contracts/audio-generation.types';
import { ElevenLabsAudioAdapter } from './providers/elevenlabs-audio.adapter';
import { MiniMaxAudioAdapter } from './providers/minimax-audio.adapter';
import { QwenAudioAdapter } from './providers/qwen-audio.adapter';

@Injectable()
export class AudioGenerationProviderRegistry {
  private readonly providers: Map<string, AudioGenerationProvider>;

  constructor(
    minimax: MiniMaxAudioAdapter,
    elevenLabs: ElevenLabsAudioAdapter,
    qwen: QwenAudioAdapter,
  ) {
    this.providers = new Map<string, AudioGenerationProvider>([
      [minimax.providerKey, minimax],
      [elevenLabs.providerKey, elevenLabs],
      [qwen.providerKey, qwen],
    ]);
  }

  resolve(config: ResolvedAudioGenerationConfig): AudioGenerationProvider {
    const provider = this.providers.get(config.providerKey);
    if (!provider) throw new Error(`AUDIO_GENERATION_ADAPTER_NOT_FOUND:${config.providerKey}`);
    return provider;
  }
}
