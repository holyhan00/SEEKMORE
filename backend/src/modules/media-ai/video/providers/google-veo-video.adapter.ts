import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PreparedVideoReference,
  VideoProviderAdapter,
  VideoProviderExecutionRequest,
  VideoProviderOutput,
  VideoProviderRequest,
} from '../video-generation.types';
import {
  GOOGLE_VEO_3_1_FAST_MODEL,
  GOOGLE_VEO_3_1_LITE_MODEL,
  GOOGLE_VEO_3_1_MODEL,
} from '../video-provider.catalog';
import {
  abortableDelay,
  base64InlineData,
  downloadVideo,
  normalizeAspectRatio,
  normalizeModel,
  normalizeResolution,
  providerMaxPolls,
  providerPollIntervalMs,
  responseRecord,
} from './video-provider.util';

const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = GOOGLE_VEO_3_1_MODEL;
const FAST_MODEL = GOOGLE_VEO_3_1_FAST_MODEL;
const LITE_MODEL = GOOGLE_VEO_3_1_LITE_MODEL;
const SUPPORTED_MODELS = new Set([DEFAULT_MODEL, FAST_MODEL, LITE_MODEL]);

@Injectable()
export class GoogleVeoVideoAdapter implements VideoProviderAdapter {
  readonly providerKey = 'google' as const;

  supports(request: VideoProviderRequest): boolean {
    try {
      this.assertSupported(request);
      return true;
    } catch {
      return false;
    }
  }

  async generate(request: VideoProviderExecutionRequest): Promise<VideoProviderOutput> {
    const model = this.assertSupported(request);
    const instance = this.instance(request.references, request.prompt);
    const parameters = this.parameters(request, model);
    const created = await responseRecord(
      await fetch(`${GOOGLE_BASE_URL}/models/${encodeURIComponent(model)}:predictLongRunning`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': request.credential.apiKey,
        },
        body: JSON.stringify({
          instances: [instance],
          ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
        }),
        signal: request.signal,
      }),
      'VIDEO_GOOGLE_CREATE_FAILED',
    );

    const operationName = String(created.name ?? '').trim();
    if (!operationName) throw new Error('VIDEO_GOOGLE_OPERATION_ID_MISSING');

    const completed = await this.poll(operationName, request);
    const video = extractGoogleVideo(completed);
    const buffer = await downloadVideo({
      url: video.uri,
      headers: { 'x-goog-api-key': request.credential.apiKey },
      signal: request.signal,
    });

    return {
      buffer,
      mimeType: 'video/mp4',
      extension: 'mp4',
      providerKey: this.providerKey,
      model,
      metadata: {
        operationName,
        generatedAudio: true,
        ...(video.mimeType ? { providerMimeType: video.mimeType } : {}),
      },
    };
  }

  private assertSupported(request: VideoProviderRequest): string {
    const model = normalizeModel(request.model) ?? DEFAULT_MODEL;
    if (!SUPPORTED_MODELS.has(model)) {
      throw new BadRequestException('VIDEO_GOOGLE_MODEL_UNSUPPORTED');
    }
    if (request.audio === 'silent') {
      throw new BadRequestException('VIDEO_GOOGLE_SILENT_OUTPUT_UNSUPPORTED');
    }

    const aspectRatio = normalizeAspectRatio(request.aspectRatio);
    if (aspectRatio && aspectRatio !== '16:9' && aspectRatio !== '9:16') {
      throw new BadRequestException('VIDEO_GOOGLE_ASPECT_RATIO_UNSUPPORTED');
    }

    const resolution = normalizeGoogleResolution(request.resolution);
    if (resolution && !['720p', '1080p', '4k'].includes(resolution)) {
      throw new BadRequestException('VIDEO_GOOGLE_RESOLUTION_UNSUPPORTED');
    }
    if (model === LITE_MODEL && resolution === '4k') {
      throw new BadRequestException('VIDEO_GOOGLE_RESOLUTION_UNSUPPORTED');
    }

    const duration = request.durationSeconds == null ? null : Number(request.durationSeconds);
    if (duration != null && ![4, 6, 8].includes(duration)) {
      throw new BadRequestException('VIDEO_GOOGLE_DURATION_UNSUPPORTED');
    }

    const references = request.references;
    if (references.some((item) => item.mediaType === 'video')) {
      throw new BadRequestException('VIDEO_GOOGLE_REFERENCE_VIDEO_UNSUPPORTED');
    }
    const genericReferences = references.filter(isGenericReference);
    const firstFrame = references.find((item): item is Extract<PreparedVideoReference, { mediaType: 'image' }> => item.mediaType === 'image' && item.role === 'first_frame');
    const lastFrame = references.find((item): item is Extract<PreparedVideoReference, { mediaType: 'image' }> => item.mediaType === 'image' && item.role === 'last_frame');

    if (genericReferences.length > 3) {
      throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
    }
    if (model === LITE_MODEL && genericReferences.length > 0) {
      throw new BadRequestException('VIDEO_GOOGLE_REFERENCE_IMAGES_UNSUPPORTED');
    }
    if (lastFrame && !firstFrame) {
      throw new BadRequestException('VIDEO_LAST_FRAME_REQUIRES_FIRST_FRAME');
    }

    const requiresEightSeconds = genericReferences.length > 0 || resolution === '1080p' || resolution === '4k';
    if (requiresEightSeconds && duration != null && duration !== 8) {
      throw new BadRequestException('VIDEO_GOOGLE_DURATION_REQUIRES_8_SECONDS');
    }

    return model;
  }

  private instance(
    references: PreparedVideoReference[],
    prompt: string,
  ): Record<string, unknown> {
    const firstFrame = references.find((item): item is Extract<PreparedVideoReference, { mediaType: 'image' }> => item.mediaType === 'image' && item.role === 'first_frame');
    const lastFrame = references.find((item): item is Extract<PreparedVideoReference, { mediaType: 'image' }> => item.mediaType === 'image' && item.role === 'last_frame');
    const genericReferences = references.filter(isGenericReference);

    return {
      prompt,
      ...(firstFrame
        ? { image: base64InlineData(firstFrame) }
        : {}),
      ...(lastFrame
        ? { lastFrame: base64InlineData(lastFrame) }
        : {}),
      ...(genericReferences.length > 0
        ? {
            referenceImages: genericReferences.map((reference) => ({
              image: base64InlineData(reference),
              referenceType: 'asset',
            })),
          }
        : {}),
    };
  }

  private parameters(
    request: VideoProviderRequest,
    model: string,
  ): Record<string, unknown> {
    const references = request.references.filter(isGenericReference);
    const resolution = normalizeGoogleResolution(request.resolution);
    const explicitDuration = request.durationSeconds == null
      ? null
      : Number(request.durationSeconds);
    const durationSeconds = explicitDuration
      ?? (references.length > 0 || resolution === '1080p' || resolution === '4k' ? 8 : null);

    return {
      ...(normalizeAspectRatio(request.aspectRatio)
        ? { aspectRatio: normalizeAspectRatio(request.aspectRatio) }
        : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
      ...(resolution ? { resolution } : {}),
      ...(model === LITE_MODEL ? {} : {}),
    };
  }

  private async poll(
    operationName: string,
    request: VideoProviderExecutionRequest,
  ): Promise<Record<string, any>> {
    const url = operationName.startsWith('http://') || operationName.startsWith('https://')
      ? operationName
      : `${GOOGLE_BASE_URL}/${operationName.replace(/^\/+/, '')}`;

    for (let attempt = 0; attempt < providerMaxPolls(); attempt += 1) {
      const operation = await responseRecord(
        await fetch(url, {
          headers: { 'x-goog-api-key': request.credential.apiKey },
          signal: request.signal,
        }),
        'VIDEO_GOOGLE_QUERY_FAILED',
      );
      if (operation.done === true) {
        if (operation.error) {
          const message = String(operation.error?.message ?? 'operation failed');
          throw new Error(`VIDEO_GOOGLE_GENERATION_FAILED:${message}`);
        }
        return operation;
      }
      await abortableDelay(providerPollIntervalMs(), request.signal);
    }
    throw new Error('VIDEO_GOOGLE_GENERATION_TIMEOUT');
  }
}

function isGenericReference(reference: PreparedVideoReference): reference is Extract<PreparedVideoReference, { mediaType: 'image' }> {
  return reference.mediaType === 'image' && (reference.role === 'subject'
    || reference.role === 'style'
    || reference.role === 'reference');
}

function normalizeGoogleResolution(value: unknown): string | null {
  const normalized = normalizeResolution(value)?.toLowerCase() ?? null;
  if (normalized === '4k') return '4k';
  if (normalized === '1080p') return '1080p';
  if (normalized === '720p') return '720p';
  return normalized;
}

function extractGoogleVideo(operation: Record<string, any>): {
  uri: string;
  mimeType?: string;
} {
  const response = operation.response ?? {};
  const generated = response.generateVideoResponse?.generatedSamples
    ?? response.generatedVideos
    ?? response.videos
    ?? [];
  const first = Array.isArray(generated) ? generated[0] ?? {} : {};
  const video = first.video ?? first;
  const uri = String(video.uri ?? video.videoUri ?? '').trim();
  if (!uri) throw new Error('VIDEO_GOOGLE_RESULT_URI_MISSING');
  return {
    uri,
    mimeType: String(video.mimeType ?? '').trim() || undefined,
  };
}
