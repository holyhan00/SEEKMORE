import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ResolvedAudioGenerationConfig } from '../../llm-settings/contracts/llm-settings.types';
import { RuntimeObjectService } from '../../object-runtime/object/object.service';
import type { ObjectCatalogCard } from '../../object-runtime/object/object.types';
import { AudioGenerationProviderRegistry } from './audio-generation-provider.registry';
import { UserVoiceAssetRepository } from './user-voice-asset.repository';

const VOICE_CONSENT_VERSION = '2026-08-01';
const VOICE_CLONE_MAX_BYTES = 20 * 1024 * 1024;

interface AudioProviderOutput {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AudioGenerationService {
  constructor(
    private readonly providers: AudioGenerationProviderRegistry,
    private readonly objects: RuntimeObjectService,
    private readonly voices: UserVoiceAssetRepository,
  ) {}

  async synthesize(input: {
    config: ResolvedAudioGenerationConfig;
    userId: string;
    agentId: string;
    conversationId: string;
    text: string;
    voiceId?: string | null;
    speed?: number;
    signal?: AbortSignal;
  }): Promise<{ objects: ObjectCatalogCard[] }> {
    const text = String(input.text ?? '').trim();
    if (!text) throw new BadRequestException('SPEECH_TEXT_REQUIRED');
    if (text.length > 5_000) {
      throw new BadRequestException('SPEECH_TEXT_TOO_LONG');
    }

    const config = input.config;
    const voiceId = await this.voices.resolveUsableExternalVoiceId(
      input.userId,
      config.providerKey,
      String(input.voiceId ?? ''),
    );

    const output = await this.providers.resolve(config).synthesize({
      config,
      text,
      voiceId: voiceId || null,
      speed: input.speed,
      signal: input.signal,
    });

    const card = await this.persistAudio(
      input,
      output,
      {
        type: 'speech_generation',
        providerKey: config.providerKey,
        modelKey: config.speechModelKey,
        voiceId: voiceId || null,
      },
      'generated-speech',
    );

    return { objects: [card] };
  }

  async cloneVoice(input: {
    config: ResolvedAudioGenerationConfig;
    userId: string;
    agentId: string;
    conversationId: string;
    objectId: string;
    displayName: string;
    consentConfirmed: boolean;
    removeBackgroundNoise?: boolean;
    signal?: AbortSignal;
  }) {
    if (input.consentConfirmed !== true) {
      throw new BadRequestException('VOICE_CLONE_CONSENT_REQUIRED');
    }

    const displayName = String(input.displayName ?? '').trim();
    if (!displayName) {
      throw new BadRequestException('VOICE_DISPLAY_NAME_REQUIRED');
    }

    const config = input.config;
    const { object, buffer } = await this.objects.readBuffer(
      {
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
      },
      input.objectId,
      VOICE_CLONE_MAX_BYTES,
    );

    if (object.objectKind !== 'audio') {
      throw new BadRequestException('VOICE_SOURCE_AUDIO_REQUIRED');
    }

    const supportedMimeTypes = new Set([
      'audio/mpeg',
      'audio/mp4',
      'audio/x-m4a',
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
    ]);
    if (!supportedMimeTypes.has(object.mimeType)) {
      throw new BadRequestException('VOICE_SOURCE_FORMAT_UNSUPPORTED');
    }

    const result = await this.providers.resolve(config).cloneVoice({
      config,
      displayName,
      source: {
        objectId: object.id,
        originalName: object.originalName,
        mimeType: object.mimeType,
        buffer,
      },
      removeBackgroundNoise: input.removeBackgroundNoise === true,
      signal: input.signal,
    });

    const asset = await this.voices.create({
      userId: input.userId,
      providerKey: config.providerKey,
      externalVoiceId: result.externalVoiceId,
      displayName,
      sourceObjectId: object.id,
      consentVersion: VOICE_CONSENT_VERSION,
      requiresVerification: result.requiresVerification,
      status: result.requiresVerification
        ? 'verification_required'
        : 'ready',
      statusReason: result.requiresVerification
        ? 'PROVIDER_VERIFICATION_REQUIRED'
        : null,
      metadata: result.metadata ?? {},
    });

    return {
      voiceAssetId: asset.id,
      voiceId: asset.externalVoiceId,
      providerKey: asset.providerKey,
      displayName: asset.displayName,
      requiresVerification: asset.requiresVerification,
      status: asset.status,
      statusReason: asset.statusReason,
    };
  }

  async generateMusic(input: {
    config: ResolvedAudioGenerationConfig;
    userId: string;
    agentId: string;
    conversationId: string;
    prompt: string;
    lyrics?: string | null;
    instrumental?: boolean;
    signal?: AbortSignal;
  }): Promise<{ objects: ObjectCatalogCard[] }> {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new BadRequestException('MUSIC_PROMPT_REQUIRED');
    if (prompt.length > 1_500) {
      throw new BadRequestException('MUSIC_PROMPT_TOO_LONG');
    }

    const lyrics = String(input.lyrics ?? '').trim();
    if (lyrics.length > 2_500) {
      throw new BadRequestException('MUSIC_LYRICS_TOO_LONG');
    }
    if (prompt.length + lyrics.length > 4_000) {
      throw new BadRequestException('MUSIC_INPUT_TOO_LONG');
    }

    const config = input.config;
    const output = await this.providers.resolve(config).generateMusic({
      config,
      prompt,
      lyrics: lyrics || null,
      instrumental: input.instrumental === true,
      signal: input.signal,
    });

    const card = await this.persistAudio(
      input,
      output,
      {
        type: 'music_generation',
        providerKey: config.providerKey,
        modelKey: config.musicModelKey,
        prompt,
        instrumental: input.instrumental === true,
      },
      'generated-music',
    );

    return { objects: [card] };
  }

  private async persistAudio(
    partition: {
      userId: string;
      agentId: string;
      conversationId: string;
    },
    output: AudioProviderOutput,
    generation: Record<string, unknown>,
    prefix: string,
  ): Promise<ObjectCatalogCard> {
    const metadata = toInputJson({
      origin: { type: 'generated' },
      generation,
      providerMedia: output.metadata ?? {},
      media: normalizeProviderMedia(output.metadata, output.extension),
    });

    const object = await this.objects.createGenerated({
      ...partition,
      originalName: `${prefix}-${Date.now()}.${output.extension}`,
      mimeType: output.mimeType,
      buffer: output.buffer,
      metadata,
    });

    return this.objects.inspectCard(partition, object.id);
  }
}

function normalizeProviderMedia(
  metadata: Record<string, unknown> | undefined,
  extension: string,
): Record<string, unknown> {
  const source = isRecord(metadata) ? metadata : {};
  const durationMs = positiveNumber(source.durationMs);
  const sampleRate = positiveInteger(source.sampleRate);
  const channels = positiveInteger(source.channels);
  const bitrate = positiveInteger(source.bitrate);
  const codec = textValue(source.codec);

  return {
    format: String(extension ?? '').trim().toLowerCase() || 'mp3',
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(sampleRate !== undefined ? { sampleRate } : {}),
    ...(channels !== undefined ? { channels } : {}),
    ...(bitrate !== undefined ? { bitrate } : {}),
    ...(codec ? { codec } : {}),
  };
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  ) as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function textValue(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}
