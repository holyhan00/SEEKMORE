import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PreparedVideoImageReference,
  PreparedVideoReference,
  PreparedVideoVideoReference,
  VideoProviderAdapter,
  VideoProviderExecutionRequest,
  VideoProviderOutput,
  VideoProviderRequest,
} from '../video-generation.types';
import {
  MINIMAX_H3_MAX_MODEL,
  MINIMAX_H3_MODEL,
} from '../video-provider.catalog';
import {
  abortableDelay,
  base64DataUrl,
  downloadVideo,
  mp4DurationSeconds,
  normalizeAspectRatio,
  normalizeModel,
  normalizeResolution,
  numberOrNull,
  providerMaxPolls,
  providerPollIntervalMs,
  responseRecord,
} from './video-provider.util';

const MINIMAX_BASE_URL = 'https://api.minimax.io/v2';
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const SUPPORTED_RATIOS = new Set([
  'adaptive',
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
]);

@Injectable()
export class MiniMaxVideoAdapter implements VideoProviderAdapter {
  readonly providerKey = 'minimax' as const;

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
    const body = this.body(request, model);
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
      throw new BadRequestException('VIDEO_MINIMAX_REQUEST_TOO_LARGE');
    }

    const created = await responseRecord(
      await fetch(`${MINIMAX_BASE_URL}/video_generation`, {
        method: 'POST',
        headers: headers(request.credential.apiKey),
        body: serialized,
        signal: request.signal,
      }),
      'VIDEO_MINIMAX_CREATE_FAILED',
    );

    const taskId = String(created.task_id ?? '').trim();
    if (!taskId) {
      throwMiniMaxProviderError(created, 'VIDEO_MINIMAX_TASK_ID_MISSING');
    }

    const completed = await this.poll(taskId, request);
    const task = record(completed.task);
    const content = record(task.content);
    const downloadUrl = String(content.url ?? '').trim();
    if (!downloadUrl) throw new Error('VIDEO_MINIMAX_DOWNLOAD_URL_MISSING');

    const buffer = await downloadVideo({ url: downloadUrl, signal: request.signal });
    return {
      buffer,
      mimeType: 'video/mp4',
      extension: 'mp4',
      providerKey: this.providerKey,
      model,
      metadata: {
        taskId,
        durationSeconds: numberOrNull(task.duration),
        resolution: String(task.resolution ?? '').trim() || null,
        aspectRatio: String(task.ratio ?? '').trim() || null,
        generatedAudio: true,
      },
    };
  }

  private assertSupported(request: VideoProviderRequest): string {
    const model = normalizeModel(request.model) ?? MINIMAX_H3_MODEL;
    if (model !== MINIMAX_H3_MODEL && model !== MINIMAX_H3_MAX_MODEL) {
      throw new BadRequestException('VIDEO_MINIMAX_MODEL_UNSUPPORTED');
    }
    if (request.audio === 'silent') {
      throw new BadRequestException('VIDEO_MINIMAX_SILENT_OUTPUT_UNSUPPORTED');
    }

    const firstFrames = request.references.filter(isFirstFrame);
    const lastFrames = request.references.filter(isLastFrame);
    const genericImages = request.references.filter(isGenericImageReference);
    const referenceVideos = request.references.filter(isReferenceVideo);

    if (firstFrames.length > 1 || lastFrames.length > 1) {
      throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
    }
    if (lastFrames.length > 0 && firstFrames.length === 0) {
      throw new BadRequestException('VIDEO_MINIMAX_LAST_FRAME_REQUIRES_FIRST_FRAME');
    }

    const hasReferenceMode = genericImages.length > 0 || referenceVideos.length > 0;
    const hasFrameMode = firstFrames.length > 0 || lastFrames.length > 0;
    if (hasReferenceMode && hasFrameMode) {
      throw new BadRequestException('VIDEO_MINIMAX_REFERENCE_MODE_CONFLICT');
    }

    if (model === MINIMAX_H3_MAX_MODEL && hasReferenceMode) {
      throw new BadRequestException('VIDEO_MINIMAX_H3_MAX_REFERENCE_UNSUPPORTED');
    }
    if (genericImages.length > 9 || referenceVideos.length > 3) {
      throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
    }
    if (genericImages.length + referenceVideos.length > 12) {
      throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
    }

    for (const reference of request.references) {
      if (reference.mediaType === 'image') this.assertImage(reference);
      else this.assertVideo(reference);
    }
    if (referenceVideos.length > 0) {
      const totalDuration = referenceVideos.reduce((sum, reference) => {
        const duration = mp4DurationSeconds(reference.buffer);
        if (duration == null) {
          throw new BadRequestException('VIDEO_MINIMAX_REFERENCE_VIDEO_DURATION_UNREADABLE');
        }
        if (duration < 2 || duration > 15) {
          throw new BadRequestException('VIDEO_MINIMAX_REFERENCE_VIDEO_DURATION_UNSUPPORTED');
        }
        return sum + duration;
      }, 0);
      if (totalDuration > 15.05) {
        throw new BadRequestException('VIDEO_MINIMAX_REFERENCE_VIDEO_TOTAL_DURATION_EXCEEDED');
      }
    }

    const resolution = normalizeMiniMaxResolution(request.resolution) ?? '768P';
    const supportedResolutions = model === MINIMAX_H3_MODEL
      ? new Set(['768P', '2K'])
      : new Set(['480P', '768P']);
    if (!supportedResolutions.has(resolution)) {
      throw new BadRequestException('VIDEO_MINIMAX_RESOLUTION_UNSUPPORTED');
    }

    const duration = request.durationSeconds == null ? 5 : Number(request.durationSeconds);
    const minimumDuration = model === MINIMAX_H3_MODEL ? 4 : 5;
    if (!Number.isInteger(duration) || duration < minimumDuration || duration > 15) {
      throw new BadRequestException('VIDEO_MINIMAX_DURATION_UNSUPPORTED');
    }

    const aspectRatio = normalizeAspectRatio(request.aspectRatio);
    if (aspectRatio && !SUPPORTED_RATIOS.has(aspectRatio)) {
      throw new BadRequestException('VIDEO_MINIMAX_ASPECT_RATIO_UNSUPPORTED');
    }
    if (!hasFrameMode && !hasReferenceMode && aspectRatio === 'adaptive') {
      throw new BadRequestException('VIDEO_MINIMAX_TEXT_RATIO_ADAPTIVE_UNSUPPORTED');
    }

    return model;
  }

  private body(request: VideoProviderRequest, model: string): Record<string, unknown> {
    const firstFrame = request.references.find(isFirstFrame);
    const lastFrame = request.references.find(isLastFrame);
    const genericImages = request.references.filter(isGenericImageReference);
    const referenceVideos = request.references.filter(isReferenceVideo);

    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: request.prompt },
    ];
    if (firstFrame) content.push(imageContent(firstFrame, 'first_frame'));
    if (lastFrame) content.push(imageContent(lastFrame, 'last_frame'));
    for (const reference of genericImages) {
      content.push(imageContent(reference, 'reference_image'));
    }
    for (const reference of referenceVideos) {
      content.push(videoContent(reference));
    }

    const hasFrameMode = Boolean(firstFrame || lastFrame);
    const hasReferenceMode = genericImages.length > 0 || referenceVideos.length > 0;
    const explicitRatio = normalizeAspectRatio(request.aspectRatio);
    const ratio = hasFrameMode
      ? 'adaptive'
      : hasReferenceMode
        ? explicitRatio ?? 'adaptive'
        : explicitRatio ?? '16:9';

    return {
      model,
      content,
      resolution: normalizeMiniMaxResolution(request.resolution) ?? '768P',
      duration: request.durationSeconds == null ? 5 : Number(request.durationSeconds),
      ratio,
    };
  }

  private assertImage(reference: PreparedVideoImageReference): void {
    if (reference.buffer.length > 30 * 1024 * 1024) {
      throw new BadRequestException('VIDEO_MINIMAX_REFERENCE_TOO_LARGE');
    }
    const ratio = reference.width / reference.height;
    if (
      reference.width < 256
      || reference.width > 5760
      || reference.height < 256
      || reference.height > 5760
      || ratio < 0.4
      || ratio > 2.5
    ) {
      throw new BadRequestException('VIDEO_MINIMAX_REFERENCE_DIMENSIONS_UNSUPPORTED');
    }
  }

  private assertVideo(reference: PreparedVideoVideoReference): void {
    if (reference.mimeType !== 'video/mp4') {
      throw new BadRequestException('VIDEO_MINIMAX_REFERENCE_VIDEO_FORMAT_UNSUPPORTED');
    }
    if (reference.buffer.length > 50 * 1024 * 1024) {
      throw new BadRequestException('VIDEO_MINIMAX_REFERENCE_VIDEO_TOO_LARGE');
    }
  }

  private async poll(
    taskId: string,
    request: VideoProviderExecutionRequest,
  ): Promise<Record<string, any>> {
    for (let attempt = 0; attempt < providerMaxPolls(); attempt += 1) {
      const body = await responseRecord(
        await fetch(`${MINIMAX_BASE_URL}/query/video_generation/${encodeURIComponent(taskId)}`, {
          headers: { authorization: `Bearer ${request.credential.apiKey}` },
          signal: request.signal,
        }),
        'VIDEO_MINIMAX_QUERY_FAILED',
      );
      const task = record(body.task);
      const status = String(task.status ?? '').trim().toLowerCase();
      if (status === 'succeeded') return body;
      if (status === 'failed' || status === 'cancelled') {
        throw new Error(`VIDEO_MINIMAX_GENERATION_${status.toUpperCase()}`);
      }
      if (status !== 'queued' && status !== 'running') {
        throwMiniMaxProviderError(body, `VIDEO_MINIMAX_STATUS_UNKNOWN:${status || 'empty'}`);
      }
      await abortableDelay(providerPollIntervalMs(), request.signal);
    }
    throw new Error('VIDEO_MINIMAX_GENERATION_TIMEOUT');
  }
}

function isFirstFrame(reference: PreparedVideoReference): reference is PreparedVideoImageReference {
  return reference.mediaType === 'image' && reference.role === 'first_frame';
}

function isLastFrame(reference: PreparedVideoReference): reference is PreparedVideoImageReference {
  return reference.mediaType === 'image' && reference.role === 'last_frame';
}

function isGenericImageReference(reference: PreparedVideoReference): reference is PreparedVideoImageReference {
  return reference.mediaType === 'image'
    && (reference.role === 'subject' || reference.role === 'style' || reference.role === 'reference');
}

function isReferenceVideo(reference: PreparedVideoReference): reference is PreparedVideoVideoReference {
  return reference.mediaType === 'video' && reference.role === 'reference_video';
}

function imageContent(
  reference: PreparedVideoImageReference,
  role: 'first_frame' | 'last_frame' | 'reference_image',
): Record<string, unknown> {
  return {
    type: 'image_url',
    image_url: { url: base64DataUrl(reference) },
    role,
  };
}

function videoContent(reference: PreparedVideoVideoReference): Record<string, unknown> {
  return {
    type: 'video_url',
    video_url: { url: base64DataUrl(reference) },
    role: 'reference_video',
  };
}

function normalizeMiniMaxResolution(value: unknown): string | null {
  const normalized = normalizeResolution(value)?.toUpperCase() ?? null;
  if (normalized === '480P' || normalized === '768P' || normalized === '2K') return normalized;
  return normalized;
}

function headers(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function throwMiniMaxProviderError(body: Record<string, any>, fallback: string): never {
  const error = record(body.error);
  const type = String(error.type ?? '').trim();
  const message = String(error.message ?? '').trim();
  if (type || message) {
    throw new Error(`VIDEO_MINIMAX_PROVIDER_ERROR:${type || 'unknown'}:${message || fallback}`);
  }
  throw new Error(fallback);
}
