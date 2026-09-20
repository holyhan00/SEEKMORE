import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PreparedVideoImageReference,
  PreparedVideoReference,
  VideoProviderAdapter,
  VideoProviderExecutionRequest,
  VideoProviderOutput,
  VideoProviderRequest,
} from '../video-generation.types';
import {
  VIDU_Q3_MIX_MODEL,
  VIDU_Q3_PRO_MODEL,
  VIDU_Q3_TURBO_MODEL,
} from '../video-provider.catalog';
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

const VIDU_BASE_URL = 'https://api.vidu.com/ent/v2';
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const STANDARD_RATIOS = new Set(['16:9', '9:16', '3:4', '4:3', '1:1']);
const REFERENCE_RATIOS = new Set(['16:9', '9:16', '1:1']);
const STANDARD_RESOLUTIONS = new Set(['540p', '720p', '1080p']);

@Injectable()
export class ViduVideoAdapter implements VideoProviderAdapter {
  readonly providerKey = 'vidu' as const;

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
    const target = this.endpointAndBody(request, model);
    const serialized = JSON.stringify(target.body);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES) {
      throw new BadRequestException('VIDEO_VIDU_REQUEST_TOO_LARGE');
    }

    const created = await responseRecord(
      await fetch(`${VIDU_BASE_URL}/${target.endpoint}`, {
        method: 'POST',
        headers: headers(request.credential.apiKey),
        body: serialized,
        signal: request.signal,
      }),
      'VIDEO_VIDU_CREATE_FAILED',
    );
    const taskId = String(created.task_id ?? '').trim();
    if (!taskId) throw new Error('VIDEO_VIDU_TASK_ID_MISSING');

    const completed = await this.poll(taskId, request);
    const creations = Array.isArray(completed.creations) ? completed.creations : [];
    const first = creations[0] && typeof creations[0] === 'object'
      ? creations[0] as Record<string, any>
      : {};
    const url = String(first.url ?? '').trim();
    if (!url) throw new Error('VIDEO_VIDU_DOWNLOAD_URL_MISSING');

    const buffer = await downloadVideo({ url, signal: request.signal });
    return {
      buffer,
      mimeType: 'video/mp4',
      extension: 'mp4',
      providerKey: this.providerKey,
      model,
      metadata: {
        taskId,
        durationSeconds: request.durationSeconds ?? null,
        resolution: normalizeResolution(request.resolution),
        aspectRatio: normalizeAspectRatio(request.aspectRatio),
        generatedAudio: request.audio !== 'silent',
        endpoint: target.endpoint,
      },
    };
  }

  private assertSupported(request: VideoProviderRequest): string {
    const model = normalizeModel(request.model) ?? VIDU_Q3_PRO_MODEL;
    if (model !== VIDU_Q3_PRO_MODEL && model !== VIDU_Q3_TURBO_MODEL && model !== VIDU_Q3_MIX_MODEL) {
      throw new BadRequestException('VIDEO_VIDU_MODEL_UNSUPPORTED');
    }
    const prompt = String(request.prompt ?? '').trim();
    if (!prompt || prompt.length > 5000) {
      throw new BadRequestException('VIDEO_VIDU_PROMPT_UNSUPPORTED');
    }

    if (request.references.some((item) => item.mediaType === 'video')) {
      throw new BadRequestException('VIDEO_VIDU_Q3_REFERENCE_VIDEO_UNSUPPORTED');
    }

    const firstFrames = request.references.filter(isFirstFrame);
    const lastFrames = request.references.filter(isLastFrame);
    const genericImages = request.references.filter(isGenericImageReference);
    if (firstFrames.length > 1 || lastFrames.length > 1) {
      throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
    }
    if (lastFrames.length > 0 && firstFrames.length === 0) {
      throw new BadRequestException('VIDEO_VIDU_LAST_FRAME_REQUIRES_FIRST_FRAME');
    }
    if (genericImages.length > 0 && (firstFrames.length > 0 || lastFrames.length > 0)) {
      throw new BadRequestException('VIDEO_VIDU_REFERENCE_MODE_CONFLICT');
    }

    if (model === VIDU_Q3_MIX_MODEL && genericImages.length === 0) {
      throw new BadRequestException('VIDEO_VIDU_Q3_MIX_REFERENCE_REQUIRED');
    }
    if (model === VIDU_Q3_PRO_MODEL && genericImages.length > 0) {
      throw new BadRequestException('VIDEO_VIDU_Q3_PRO_REFERENCE_UNSUPPORTED');
    }
    if (genericImages.length > 7) {
      throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
    }

    for (const reference of request.references) {
      if (reference.mediaType !== 'image') {
        throw new BadRequestException('VIDEO_VIDU_REFERENCE_VIDEO_UNSUPPORTED');
      }
      this.assertImage(reference, genericImages.includes(reference));
    }

    if (firstFrames[0] && lastFrames[0]) {
      const startRatio = firstFrames[0].width / firstFrames[0].height;
      const endRatio = lastFrames[0].width / lastFrames[0].height;
      const ratio = startRatio / endRatio;
      if (ratio < 0.8 || ratio > 1.25) {
        throw new BadRequestException('VIDEO_VIDU_START_END_ASPECT_RATIO_MISMATCH');
      }
    }

    const duration = request.durationSeconds == null ? 5 : Number(request.durationSeconds);
    const minimumDuration = genericImages.length > 0 && model !== VIDU_Q3_MIX_MODEL ? 3 : 1;
    if (!Number.isInteger(duration) || duration < minimumDuration || duration > 16) {
      throw new BadRequestException('VIDEO_VIDU_DURATION_UNSUPPORTED');
    }

    const resolution = normalizeResolution(request.resolution) ?? '720p';
    if (!STANDARD_RESOLUTIONS.has(resolution)) {
      throw new BadRequestException('VIDEO_VIDU_RESOLUTION_UNSUPPORTED');
    }
    if (model === VIDU_Q3_MIX_MODEL && resolution === '540p') {
      throw new BadRequestException('VIDEO_VIDU_Q3_MIX_RESOLUTION_UNSUPPORTED');
    }

    const aspectRatio = normalizeAspectRatio(request.aspectRatio);
    if (firstFrames.length > 0 && aspectRatio) {
      throw new BadRequestException('VIDEO_VIDU_IMAGE_ASPECT_RATIO_CONTROL_UNSUPPORTED');
    }
    if (genericImages.length > 0) {
      if (aspectRatio && !REFERENCE_RATIOS.has(aspectRatio)) {
        throw new BadRequestException('VIDEO_VIDU_REFERENCE_ASPECT_RATIO_UNSUPPORTED');
      }
    } else if (aspectRatio && !STANDARD_RATIOS.has(aspectRatio)) {
      throw new BadRequestException('VIDEO_VIDU_ASPECT_RATIO_UNSUPPORTED');
    }

    return model;
  }

  private endpointAndBody(
    request: VideoProviderRequest,
    model: string,
  ): { endpoint: string; body: Record<string, unknown> } {
    const firstFrame = request.references.find(isFirstFrame);
    const lastFrame = request.references.find(isLastFrame);
    const genericImages = request.references.filter(isGenericImageReference);
    const common = {
      model,
      prompt: request.prompt,
      duration: request.durationSeconds == null ? 5 : Number(request.durationSeconds),
      resolution: normalizeResolution(request.resolution) ?? '720p',
      audio: request.audio === 'silent' ? false : true,
    };

    if (genericImages.length > 0) {
      return {
        endpoint: 'reference2video',
        body: {
          ...common,
          images: genericImages.map((item) => base64DataUrl(item)),
          aspect_ratio: normalizeAspectRatio(request.aspectRatio) ?? '16:9',
        },
      };
    }
    if (firstFrame && lastFrame) {
      return {
        endpoint: 'start-end2video',
        body: {
          ...common,
          images: [base64DataUrl(firstFrame), base64DataUrl(lastFrame)],
          is_rec: false,
        },
      };
    }
    if (firstFrame) {
      return {
        endpoint: 'img2video',
        body: {
          ...common,
          images: [base64DataUrl(firstFrame)],
          is_rec: false,
        },
      };
    }
    return {
      endpoint: 'text2video',
      body: {
        ...common,
        aspect_ratio: normalizeAspectRatio(request.aspectRatio) ?? '16:9',
      },
    };
  }

  private assertImage(reference: PreparedVideoImageReference, generic: boolean): void {
    if (reference.width < 128 || reference.height < 128) {
      throw new BadRequestException('VIDEO_VIDU_REFERENCE_DIMENSIONS_UNSUPPORTED');
    }
    const ratio = reference.width / reference.height;
    if (ratio < 0.25 || ratio > 4) {
      throw new BadRequestException('VIDEO_VIDU_REFERENCE_ASPECT_RATIO_UNSUPPORTED');
    }
    const maximum = generic ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
    if (reference.buffer.length > maximum) {
      throw new BadRequestException('VIDEO_VIDU_REFERENCE_TOO_LARGE');
    }
  }

  private async poll(taskId: string, request: VideoProviderExecutionRequest): Promise<Record<string, any>> {
    for (let attempt = 0; attempt < providerMaxPolls(); attempt += 1) {
      const body = await responseRecord(
        await fetch(`${VIDU_BASE_URL}/tasks/${encodeURIComponent(taskId)}/creations`, {
          headers: { authorization: `Token ${request.credential.apiKey}` },
          signal: request.signal,
        }),
        'VIDEO_VIDU_QUERY_FAILED',
      );
      const state = String(body.state ?? '').trim().toLowerCase();
      if (state === 'success') return body;
      if (state === 'failed') {
        throw new Error(`VIDEO_VIDU_GENERATION_FAILED:${String(body.err_code ?? '').trim()}`);
      }
      if (state !== 'created' && state !== 'queueing' && state !== 'processing') {
        throw new Error(`VIDEO_VIDU_STATUS_UNKNOWN:${state || 'empty'}`);
      }
      await abortableDelay(providerPollIntervalMs(), request.signal);
    }
    throw new Error('VIDEO_VIDU_GENERATION_TIMEOUT');
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

function headers(apiKey: string): Record<string, string> {
  return {
    authorization: `Token ${apiKey}`,
    'content-type': 'application/json',
  };
}
