import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PreparedVideoImageReference,
  PreparedVideoReference,
  VideoProviderAdapter,
  VideoProviderExecutionRequest,
  VideoProviderOutput,
  VideoProviderRequest,
} from '../video-generation.types';
import { ZHIPU_COGVIDEOX_3_MODEL } from '../video-provider.catalog';
import {
  abortableDelay,
  base64DataUrl,
  downloadVideo,
  normalizeAspectRatio,
  normalizeModel,
  normalizeResolution,
  providerMaxPolls,
  providerPollIntervalMs,
  responseRecord,
} from './video-provider.util';

const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const SUPPORTED_RATIOS = new Set(['16:9', '1:1', '9:16']);

@Injectable()
export class ZhipuVideoAdapter implements VideoProviderAdapter {
  readonly providerKey = 'zhipu' as const;

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
    const created = await responseRecord(
      await fetch(`${ZHIPU_BASE_URL}/videos/generations`, {
        method: 'POST',
        headers: headers(request.credential.apiKey),
        body: JSON.stringify(this.body(request, model)),
        signal: request.signal,
      }),
      'VIDEO_ZHIPU_CREATE_FAILED',
    );
    const taskId = String(created.id ?? '').trim();
    if (!taskId) throw new Error('VIDEO_ZHIPU_TASK_ID_MISSING');

    const completed = await this.poll(taskId, request);
    const results = Array.isArray(completed.video_result) ? completed.video_result : [];
    const first = results[0] && typeof results[0] === 'object'
      ? results[0] as Record<string, any>
      : {};
    const url = String(first.url ?? '').trim();
    if (!url) throw new Error('VIDEO_ZHIPU_DOWNLOAD_URL_MISSING');

    const buffer = await downloadVideo({ url, signal: request.signal });
    return {
      buffer,
      mimeType: 'video/mp4',
      extension: 'mp4',
      providerKey: this.providerKey,
      model,
      metadata: {
        taskId,
        durationSeconds: request.durationSeconds ?? 5,
        resolution: normalizeResolution(request.resolution),
        aspectRatio: normalizeAspectRatio(request.aspectRatio),
        generatedAudio: request.audio === 'required',
        fps: 30,
      },
    };
  }

  private assertSupported(request: VideoProviderRequest): string {
    const model = normalizeModel(request.model) ?? ZHIPU_COGVIDEOX_3_MODEL;
    if (model !== ZHIPU_COGVIDEOX_3_MODEL) {
      throw new BadRequestException('VIDEO_ZHIPU_MODEL_UNSUPPORTED');
    }
    if (!request.prompt.trim() || request.prompt.length > 512) {
      throw new BadRequestException('VIDEO_ZHIPU_PROMPT_UNSUPPORTED');
    }
    if (request.references.some((item) => item.mediaType === 'video')) {
      throw new BadRequestException('VIDEO_ZHIPU_REFERENCE_VIDEO_UNSUPPORTED');
    }

    const firstFrames = request.references.filter(isFirstFrame);
    const lastFrames = request.references.filter(isLastFrame);
    const generic = request.references.filter((item) => item.role === 'subject' || item.role === 'style' || item.role === 'reference');
    if (generic.length > 0) {
      throw new BadRequestException('VIDEO_ZHIPU_REFERENCE_IMAGE_UNSUPPORTED');
    }
    if (firstFrames.length > 1 || lastFrames.length > 1) {
      throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
    }
    if (lastFrames.length > 0 && firstFrames.length === 0) {
      throw new BadRequestException('VIDEO_ZHIPU_LAST_FRAME_REQUIRES_FIRST_FRAME');
    }
    for (const reference of [...firstFrames, ...lastFrames]) {
      if (reference.buffer.length > 5 * 1024 * 1024) {
        throw new BadRequestException('VIDEO_ZHIPU_REFERENCE_TOO_LARGE');
      }
      if (reference.mimeType !== 'image/png' && reference.mimeType !== 'image/jpeg') {
        throw new BadRequestException('VIDEO_ZHIPU_REFERENCE_FORMAT_UNSUPPORTED');
      }
    }

    const duration = request.durationSeconds == null ? 5 : Number(request.durationSeconds);
    if (duration !== 5 && duration !== 10) {
      throw new BadRequestException('VIDEO_ZHIPU_DURATION_UNSUPPORTED');
    }

    const ratio = normalizeAspectRatio(request.aspectRatio);
    if (ratio && !SUPPORTED_RATIOS.has(ratio)) {
      throw new BadRequestException('VIDEO_ZHIPU_ASPECT_RATIO_UNSUPPORTED');
    }
    this.resolveSize(request.resolution, ratio);
    return model;
  }

  private body(request: VideoProviderRequest, model: string): Record<string, unknown> {
    const firstFrame = request.references.find(isFirstFrame);
    const lastFrame = request.references.find(isLastFrame);
    const images = [firstFrame, lastFrame].filter(Boolean) as PreparedVideoImageReference[];
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      quality: 'quality',
      fps: 30,
      duration: request.durationSeconds == null ? 5 : Number(request.durationSeconds),
    };
    if (request.audio === 'required') body.with_audio = true;
    if (request.audio === 'silent') body.with_audio = false;
    const size = this.resolveSize(request.resolution, normalizeAspectRatio(request.aspectRatio));
    if (size) body.size = size;
    if (images.length === 1) body.image_url = base64DataUrl(images[0]);
    else if (images.length === 2) body.image_url = images.map((item) => base64DataUrl(item));
    return body;
  }

  private resolveSize(resolutionValue: unknown, ratioValue: string | null): string | null {
    const resolution = normalizeResolution(resolutionValue);
    if (!resolution) return null;
    const ratio = ratioValue ?? '16:9';
    if (resolution === '720p') {
      if (ratio === '16:9') return '1280x720';
      if (ratio === '9:16') return '720x1280';
      if (ratio === '1:1') return '1024x1024';
    }
    if (resolution === '1080p') {
      if (ratio === '16:9') return '1920x1080';
      if (ratio === '9:16') return '1080x1920';
      if (ratio === '1:1') return '1024x1024';
    }
    if (resolution === '2k' && ratio === '16:9') return '2048x1080';
    if (resolution === '4k' && ratio === '16:9') return '3840x2160';
    throw new BadRequestException('VIDEO_ZHIPU_RESOLUTION_ASPECT_RATIO_UNSUPPORTED');
  }

  private async poll(taskId: string, request: VideoProviderExecutionRequest): Promise<Record<string, any>> {
    for (let attempt = 0; attempt < providerMaxPolls(); attempt += 1) {
      const body = await responseRecord(
        await fetch(`${ZHIPU_BASE_URL}/async-result/${encodeURIComponent(taskId)}`, {
          headers: { authorization: `Bearer ${request.credential.apiKey}` },
          signal: request.signal,
        }),
        'VIDEO_ZHIPU_QUERY_FAILED',
      );
      if (Array.isArray(body.video_result) && body.video_result.length > 0) return body;
      const status = String(body.task_status ?? body.status ?? '').trim().toUpperCase();
      if (status === 'SUCCESS') return body;
      if (status === 'FAIL' || status === 'FAILED') {
        throw new Error('VIDEO_ZHIPU_GENERATION_FAILED');
      }
      if (status && status !== 'PROCESSING' && status !== 'PENDING') {
        throw new Error(`VIDEO_ZHIPU_STATUS_UNKNOWN:${status}`);
      }
      await abortableDelay(providerPollIntervalMs(), request.signal);
    }
    throw new Error('VIDEO_ZHIPU_GENERATION_TIMEOUT');
  }
}

function isFirstFrame(reference: PreparedVideoReference): reference is PreparedVideoImageReference {
  return reference.mediaType === 'image' && reference.role === 'first_frame';
}

function isLastFrame(reference: PreparedVideoReference): reference is PreparedVideoImageReference {
  return reference.mediaType === 'image' && reference.role === 'last_frame';
}

function headers(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}
