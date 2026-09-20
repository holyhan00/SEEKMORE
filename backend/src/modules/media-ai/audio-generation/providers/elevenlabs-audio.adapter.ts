                                                                                      
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
  record,
  safeFileName,
} from './audio-provider.util';

const MAX_AUDIO_OUTPUT_BYTES = 100 * 1024 * 1024;
const DEFAULT_VOICE_PAGE_SIZE = 20;

type ElevenLabsCapability =
  | 'tts'
  | 'voice_clone'
  | 'music'
  | 'voice_read';

type ElevenLabsVoiceType =
  | 'default'
  | 'non-community';

@Injectable()
export class ElevenLabsAudioAdapter implements AudioGenerationProvider {
  readonly providerKey = 'elevenlabs';

  async synthesize(
    input: SpeechSynthesisRequest,
  ): Promise<AudioBinaryOutput> {
    const voiceId = String(input.voiceId ?? '').trim()
      || String(input.config.provider.defaultVoiceId ?? '').trim()
      || await this.defaultVoiceId(
        input.config.baseUrl,
        input.config.apiKey,
        input.signal,
      );

    const response = await fetch(
      `${base(input.config.baseUrl)}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: jsonHeaders(input.config.apiKey),
        body: JSON.stringify({
          text: input.text,
          model_id: input.config.speechModelKey,
          voice_settings: {
            speed: clamp(
              input.speed ?? 1,
              0.7,
              1.2,
            ),
          },
        }),
        signal: input.signal,
      },
    );

    return {
      buffer: await elevenLabsBuffer(
        response,
        'tts',
      ),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      metadata: { voiceId },
    };
  }

  async cloneVoice(
    input: VoiceCloneRequest,
  ): Promise<VoiceCloneOutput> {
    const form = new FormData();
    form.append(
      'name',
      input.displayName,
    );
    form.append(
      'remove_background_noise',
      String(input.removeBackgroundNoise),
    );
    form.append(
      'files',
      new Blob(
        [Uint8Array.from(input.source.buffer).buffer],
        { type: input.source.mimeType },
      ),
      safeFileName(
        input.source.originalName,
        'voice-sample.wav',
      ),
    );

    const body = await elevenLabsJson(
      await fetch(
        `${base(input.config.baseUrl)}/voices/add`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': input.config.apiKey,
          },
          body: form,
          signal: input.signal,
        },
      ),
      'voice_clone',
    );

    const externalVoiceId = String(
      body.voice_id ?? '',
    ).trim();

    if (!externalVoiceId) {
      throw new BadRequestException(
        'AUDIO_PROVIDER_VOICE_CLONE_EMPTY',
      );
    }

    return {
      externalVoiceId,
      requiresVerification:
        body.requires_verification === true,
    };
  }

  async generateMusic(
    input: MusicGenerationRequest,
  ): Promise<AudioBinaryOutput> {
    const response = await fetch(
      `${base(input.config.baseUrl)}/music?output_format=mp3_48000_192`,
      {
        method: 'POST',
        headers: jsonHeaders(input.config.apiKey),
        body: JSON.stringify({
          prompt: musicPrompt(
            input.prompt,
            input.lyrics,
          ),
          model_id: input.config.musicModelKey,
          force_instrumental: input.instrumental,
        }),
        signal: input.signal,
      },
    );

    return {
      buffer: await elevenLabsBuffer(
        response,
        'music',
      ),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
    };
  }

  private async defaultVoiceId(
    baseUrl: string,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const defaultVoiceId = await this.firstAvailableVoiceId(
      baseUrl,
      apiKey,
      'default',
      signal,
    );

    if (defaultVoiceId) {
      return defaultVoiceId;
    }

    const ownedVoiceId = await this.firstAvailableVoiceId(
      baseUrl,
      apiKey,
      'non-community',
      signal,
    );

    if (ownedVoiceId) {
      return ownedVoiceId;
    }

    throw new BadRequestException(
      'AUDIO_PROVIDER_DEFAULT_VOICE_NOT_FOUND',
    );
  }

  private async firstAvailableVoiceId(
    baseUrl: string,
    apiKey: string,
    voiceType: ElevenLabsVoiceType,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const endpoint = new URL(
      `${base(baseUrl).replace(/\/v1$/, '')}/v2/voices`,
    );

    endpoint.searchParams.set(
      'page_size',
      String(DEFAULT_VOICE_PAGE_SIZE),
    );
    endpoint.searchParams.set(
      'include_total_count',
      'false',
    );
    endpoint.searchParams.set(
      'voice_type',
      voiceType,
    );
    endpoint.searchParams.set(
      'sort',
      'name',
    );
    endpoint.searchParams.set(
      'sort_direction',
      'asc',
    );

    const response = await elevenLabsJson(
      await fetch(endpoint, {
        headers: {
          'xi-api-key': apiKey,
        },
        signal,
      }),
      'voice_read',
    );

    const voices = Array.isArray(response.voices)
      ? response.voices
      : [];

    for (const voice of voices) {
      const voiceId = String(
        record(voice).voice_id ?? '',
      ).trim();

      if (voiceId) {
        return voiceId;
      }
    }

    return null;
  }
}

async function elevenLabsJson(
  response: Response,
  capability: ElevenLabsCapability,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  const body = parseResponseBody(text);

  if (!response.ok) {
    throw elevenLabsError(
      response.status,
      body,
      capability,
    );
  }

  return record(body);
}

async function elevenLabsBuffer(
  response: Response,
  capability: ElevenLabsCapability,
): Promise<Buffer> {
  if (!response.ok) {
    const text = await response.text().catch(
      () => '',
    );

    throw elevenLabsError(
      response.status,
      parseResponseBody(text),
      capability,
    );
  }

  const declaredSize = Number(
    response.headers.get('content-length') ?? 0,
  );

  if (
    Number.isFinite(declaredSize)
    && declaredSize > MAX_AUDIO_OUTPUT_BYTES
  ) {
    throw new BadRequestException(
      'AUDIO_PROVIDER_OUTPUT_TOO_LARGE',
    );
  }

  const output = Buffer.from(
    await response.arrayBuffer(),
  );

  if (output.byteLength <= 0) {
    throw new BadRequestException(
      'AUDIO_PROVIDER_EMPTY_OUTPUT',
    );
  }

  if (output.byteLength > MAX_AUDIO_OUTPUT_BYTES) {
    throw new BadRequestException(
      'AUDIO_PROVIDER_OUTPUT_TOO_LARGE',
    );
  }

  return output;
}

function elevenLabsError(
  statusCode: number,
  body: unknown,
  capability: ElevenLabsCapability,
): BadRequestException {
  const detail = errorDetail(body);

  const type = detail.type.toLowerCase();
  const code = detail.code.toLowerCase();
  const legacyStatus = detail.status.toLowerCase();
  const message = detail.message.toLowerCase();

    
                                                                       
                                                                        
                                                                 
     

  if (
    capability === 'music'
    && isPaidPlanRequired(
      code,
      message,
    )
  ) {
    return new BadRequestException(
      'ELEVENLABS_MUSIC_PAID_PLAN_REQUIRED',
    );
  }

  if (
    isPermissionDenied(
      code,
      legacyStatus,
      message,
    )
  ) {
    return new BadRequestException(
      permissionCode(capability),
    );
  }

  if (
    isVoiceUnavailable(
      code,
      message,
    )
  ) {
    return new BadRequestException(
      'ELEVENLABS_VOICE_UNAVAILABLE',
    );
  }

  if (
    isInsufficientCredits(
      type,
      code,
      message,
    )
  ) {
    return new BadRequestException(
      'ELEVENLABS_CREDITS_INSUFFICIENT',
    );
  }

  if (
    isInvalidApiKey(
      statusCode,
      code,
      type,
    )
  ) {
    return new BadRequestException(
      'ELEVENLABS_API_KEY_INVALID',
    );
  }

  if (
    isRateLimited(
      statusCode,
      code,
      type,
    )
  ) {
    return new BadRequestException(
      'ELEVENLABS_RATE_LIMITED',
    );
  }

  return new BadRequestException(
    genericFailureCode(capability),
  );
}

function isPaidPlanRequired(
  code: string,
  message: string,
): boolean {
  if (
    code === 'subscription_required'
    || code === 'feature_not_available'
  ) {
    return true;
  }

  return includesAny(message, [
    'paid subscription',
    'paid plan',
    'subscription required',
    'requires a subscription',
    'upgrade your plan',
    'upgrade to a paid',
    'not available on your current plan',
    'only available to paid',
  ]);
}

function isPermissionDenied(
  code: string,
  legacyStatus: string,
  message: string,
): boolean {
  if (
    code === 'insufficient_permissions'
    || legacyStatus === 'missing_permissions'
  ) {
    return true;
  }

  return includesAny(message, [
    'missing permission',
    'missing_permissions',
    'insufficient permission',
    'required permission',
  ]);
}

function isVoiceUnavailable(
  code: string,
  message: string,
): boolean {
  if (
    code === 'voice_not_found'
    || code === 'invalid_voice_id'
    || code === 'voice_access_denied'
  ) {
    return true;
  }

  return includesAny(message, [
    'voice not found',
    'voice unavailable',
    'does not have access to this voice',
    'do not have access to this voice',
  ]);
}

function isInsufficientCredits(
  type: string,
  code: string,
  message: string,
): boolean {
  if (
    code === 'insufficient_credits'
    || type === 'payment_required'
  ) {
    return true;
  }

  return includesAny(message, [
    'insufficient credits',
    'not enough credits',
    'quota exceeded',
    'character limit exceeded',
    'monthly character limit',
  ]);
}

function isInvalidApiKey(
  statusCode: number,
  code: string,
  type: string,
): boolean {
  if (
    code === 'invalid_api_key'
    || code === 'missing_api_key'
    || code === 'invalid_authorization_header'
  ) {
    return true;
  }

  return (
    statusCode === 401
    && type === 'authentication_error'
  );
}

function isRateLimited(
  statusCode: number,
  code: string,
  type: string,
): boolean {
  return (
    statusCode === 429
    || type === 'rate_limit_error'
    || code === 'rate_limit_exceeded'
    || code === 'concurrent_limit_exceeded'
    || code === 'system_busy'
  );
}

function includesAny(
  value: string,
  candidates: readonly string[],
): boolean {
  return candidates.some(
    (candidate) => value.includes(candidate),
  );
}

function permissionCode(
  capability: ElevenLabsCapability,
): string {
  if (capability === 'music') {
    return 'ELEVENLABS_MUSIC_PERMISSION_REQUIRED';
  }

  if (capability === 'voice_clone') {
    return 'ELEVENLABS_VOICE_CLONE_PERMISSION_REQUIRED';
  }

  if (capability === 'voice_read') {
    return 'ELEVENLABS_VOICE_READ_PERMISSION_REQUIRED';
  }

  return 'ELEVENLABS_TTS_PERMISSION_REQUIRED';
}

function genericFailureCode(
  capability: ElevenLabsCapability,
): string {
  if (capability === 'music') {
    return 'ELEVENLABS_MUSIC_GENERATION_FAILED';
  }

  if (capability === 'voice_clone') {
    return 'ELEVENLABS_VOICE_CLONE_FAILED';
  }

  if (capability === 'voice_read') {
    return 'ELEVENLABS_VOICE_LIST_FAILED';
  }

  return 'ELEVENLABS_TTS_FAILED';
}

function errorDetail(value: unknown): {
  type: string;
  code: string;
  status: string;
  message: string;
} {
  const source = record(value);
  const detail = record(source.detail);
  const error = record(source.error);

  return {
    type: textValue(
      detail.type
        ?? error.type
        ?? source.type,
    ),
    code: textValue(
      detail.code
        ?? error.code
        ?? source.code,
    ),
    status: textValue(
      detail.status
        ?? error.status
        ?? source.status,
    ),
    message: textValue(
      detail.message
        ?? error.message
        ?? source.message
        ?? source.detail
        ?? source.error,
    ),
  };
}

function parseResponseBody(
  text: string,
): unknown {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function textValue(
  value: unknown,
): string {
  const output = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  return output === '[object Object]'
    ? ''
    : output.slice(0, 500);
}

function base(
  value: string,
): string {
  return String(value ?? '')
    .replace(/\/+$/, '');
}

function jsonHeaders(
  apiKey: string,
): Record<string, string> {
  return {
    'xi-api-key': apiKey,
    'content-type': 'application/json',
  };
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.max(
    minimum,
    Math.min(
      maximum,
      Number.isFinite(value)
        ? value
        : minimum,
    ),
  );
}

function musicPrompt(
  prompt: string,
  lyrics?: string | null,
): string {
  const normalizedLyrics = String(
    lyrics ?? '',
  ).trim();

  return normalizedLyrics
    ? `${prompt}

Lyrics:
${normalizedLyrics}`
    : prompt;
}