import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  AudioBinaryOutput,
  AudioGenerationProvider,
  MusicGenerationRequest,
  SpeechSynthesisRequest,
  VoiceCloneOutput,
  VoiceCloneRequest,
} from '../contracts/audio-generation.types';
import {
  numberOrUndefined,
  record,
  responseBuffer,
  responseJson,
} from './audio-provider.util';

const QWEN_TTS_MODELS = new Set([
  'qwen-audio-3.0-tts-plus',
  'qwen-audio-3.0-tts-flash',
]);
const QWEN_MUSIC_MODELS = new Set(['fun-music-v1']);

@Injectable()
export class QwenAudioAdapter implements AudioGenerationProvider {
  readonly providerKey = 'qwen';

  async synthesize(input: SpeechSynthesisRequest): Promise<AudioBinaryOutput> {
    if (!QWEN_TTS_MODELS.has(input.config.speechModelKey)) {
      throw new BadRequestException('QWEN_SPEECH_MODEL_UNSUPPORTED');
    }

    const body = await responseJson(await fetch(
      `${base(input.config.baseUrl)}/services/audio/tts/SpeechSynthesizer`,
      {
        method: 'POST',
        headers: headers(input.config.apiKey),
        body: JSON.stringify({
          model: input.config.speechModelKey,
          input: {
            text: input.text,
            voice: input.voiceId || qwenDefaultVoice(input.config.speechModelKey, input.config),
            format: 'mp3',
            sample_rate: 24000,
            rate: clamp(input.speed ?? 1, 0.5, 2),
            enable_aigc_tag: false,
          },
        }),
        signal: input.signal,
      },
    ));

    const output = record(body.output);
    const audio = record(output.audio);
    const url = String(audio.url ?? '').trim();
    if (!url) throw new BadRequestException('AUDIO_PROVIDER_EMPTY_OUTPUT');

    return {
      buffer: await responseBuffer(await fetch(url, { signal: input.signal })),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      metadata: {
        sampleRate: 24000,
        codec: 'mp3',
        requestId: String(body.request_id ?? '').trim() || undefined,
        characters: numberOrUndefined(record(body.usage).characters),
        providerAudioId: String(audio.id ?? '').trim() || undefined,
      },
    };
  }

  async cloneVoice(_input: VoiceCloneRequest): Promise<VoiceCloneOutput> {
    // Qwen voice enrollment requires a provider-accessible sample URL. SEEKMORE's
    // current clone contract intentionally provides only a RuntimeObject buffer.
    throw new BadRequestException('QWEN_VOICE_CLONING_REQUIRES_REMOTE_AUDIO_URL');
  }

  async generateMusic(input: MusicGenerationRequest): Promise<AudioBinaryOutput> {
    if (!QWEN_MUSIC_MODELS.has(input.config.musicModelKey)) {
      throw new BadRequestException('QWEN_MUSIC_MODEL_UNSUPPORTED');
    }

    const lyrics = String(input.lyrics ?? '').trim();
    const generationInput: Record<string, unknown> = {
      is_instrumental: input.instrumental,
      format: 'mp3',
      enable_aigc_watermark: false,
    };
    if (input.instrumental || !lyrics) {
      generationInput.prompt = input.prompt;
    } else {
      // Fun-Music ignores prompt when lyrics is present. Do not send a second,
      // ineffective semantic instruction to the provider.
      generationInput.lyrics = lyrics;
    }

    const body = await responseJson(await fetch(
      `${base(input.config.baseUrl)}/services/audio/music/generation`,
      {
        method: 'POST',
        headers: headers(input.config.apiKey),
        body: JSON.stringify({
          model: input.config.musicModelKey,
          input: generationInput,
        }),
        signal: input.signal,
      },
    ));

    const output = record(body.output);
    const audio = record(output.audio);
    const extra = record(output.extra_info);
    const url = String(audio.url ?? '').trim();
    if (!url) throw new BadRequestException('AUDIO_PROVIDER_EMPTY_OUTPUT');

    const durationSeconds = numberOrUndefined(record(body.usage).duration);
    return {
      buffer: await responseBuffer(await fetch(url, { signal: input.signal })),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      metadata: {
        ...(durationSeconds !== undefined ? { durationMs: durationSeconds * 1000 } : {}),
        sampleRate: numberOrUndefined(extra.sample_rate),
        channels: numberOrUndefined(extra.channels),
        codec: 'mp3',
        requestId: String(body.request_id ?? '').trim() || undefined,
        providerAudioId: String(audio.id ?? '').trim() || undefined,
      },
    };
  }
}

function qwenDefaultVoice(
  model: string,
  config: SpeechSynthesisRequest['config'],
): string {
  if (model === config.provider.speechModelKey && config.provider.defaultVoiceId) {
    return config.provider.defaultVoiceId;
  }
  return model === 'qwen-audio-3.0-tts-plus'
    ? 'longanlingxin'
    : 'longanhuan_v3.6';
}

function base(value: string): string {
  return String(value ?? '').replace(/\/+$/, '');
}

function headers(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 1));
}
