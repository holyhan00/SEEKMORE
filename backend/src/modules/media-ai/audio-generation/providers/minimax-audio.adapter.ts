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
  assertMiniMaxSuccess,
  decodeHexAudio,
  numberOrUndefined,
  record,
  responseJson,
  safeFileName,
} from './audio-provider.util';

@Injectable()
export class MiniMaxAudioAdapter implements AudioGenerationProvider {
  readonly providerKey = 'minimax';

  async synthesize(input: SpeechSynthesisRequest): Promise<AudioBinaryOutput> {
    const body = await responseJson(await fetch(`${base(input.config.baseUrl)}/t2a_v2`, {
      method: 'POST',
      headers: headers(input.config.apiKey),
      body: JSON.stringify({
        model: input.config.speechModelKey,
        text: input.text,
        stream: false,
        output_format: 'hex',
        voice_setting: {
          voice_id: input.voiceId || input.config.provider.defaultVoiceId || 'male-qn-qingse',
          speed: clamp(input.speed ?? 1, 0.7, 1.2),
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
        subtitle_enable: false,
      }),
      signal: input.signal,
    }));
    const extra = record(body.extra_info);
    return {
      buffer: decodeHexAudio(body),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      metadata: {
        durationMs: numberOrUndefined(extra.audio_length),
        sampleRate: numberOrUndefined(extra.audio_sample_rate),
        channels: numberOrUndefined(extra.audio_channel),
        bitrate: numberOrUndefined(extra.bitrate),
        traceId: String(body.trace_id ?? '').trim() || undefined,
      },
    };
  }

  async cloneVoice(input: VoiceCloneRequest): Promise<VoiceCloneOutput> {
    const upload = new FormData();
    upload.append('purpose', 'voice_clone');
    upload.append(
      'file',
      new Blob([Uint8Array.from(input.source.buffer).buffer], { type: input.source.mimeType }),
      safeFileName(input.source.originalName, 'voice-sample.wav'),
    );
    const uploaded = await responseJson(await fetch(`${base(input.config.baseUrl)}/files/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.config.apiKey}` },
      body: upload,
      signal: input.signal,
    }));
    assertMiniMaxSuccess(uploaded);
    const fileId = Number(record(uploaded.file).file_id);
    if (!Number.isSafeInteger(fileId) || fileId <= 0) {
      throw new BadRequestException('AUDIO_PROVIDER_UPLOAD_INVALID_RESPONSE');
    }

    const voiceId = createMiniMaxVoiceId(input.displayName);
    const cloned = await responseJson(await fetch(`${base(input.config.baseUrl)}/voice_clone`, {
      method: 'POST',
      headers: headers(input.config.apiKey),
      body: JSON.stringify({
        file_id: fileId,
        voice_id: voiceId,
        need_noise_reduction: input.removeBackgroundNoise,
        need_volume_normalization: true,
        aigc_watermark: false,
      }),
      signal: input.signal,
    }));
    assertMiniMaxSuccess(cloned);
    return {
      externalVoiceId: voiceId,
      requiresVerification: false,
      metadata: { providerFileId: fileId, traceId: cloned.trace_id ?? null },
    };
  }

  async generateMusic(input: MusicGenerationRequest): Promise<AudioBinaryOutput> {
    const body = await responseJson(await fetch(`${base(input.config.baseUrl)}/music_generation`, {
      method: 'POST',
      headers: headers(input.config.apiKey),
      body: JSON.stringify({
        model: input.config.musicModelKey,
        prompt: input.prompt,
        ...(input.lyrics && !input.instrumental ? { lyrics: input.lyrics } : {}),
        lyrics_optimizer: !input.instrumental && !input.lyrics,
        is_instrumental: input.instrumental,
        stream: false,
        output_format: 'hex',
        audio_setting: {
          sample_rate: 44100,
          bitrate: 256000,
          format: 'mp3',
        },
      }),
      signal: input.signal,
    }));
    const extra = record(body.extra_info);
    return {
      buffer: decodeHexAudio(body),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      metadata: {
        durationMs: numberOrUndefined(extra.music_duration),
        sampleRate: numberOrUndefined(extra.music_sample_rate),
        channels: numberOrUndefined(extra.music_channel),
        bitrate: numberOrUndefined(extra.bitrate),
        traceId: String(body.trace_id ?? '').trim() || undefined,
      },
    };
  }
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

function createMiniMaxVoiceId(displayName: string): string {
  const prefix = String(displayName ?? '')
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]/gi, '')
    .replace(/^([^a-z])/i, 'v$1')
    .slice(0, 32) || 'seekmore';
  return `${prefix}_${Date.now().toString(36)}`.slice(0, 64).replace(/[-_]$/, '0');
}
