import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  PreparedVideoImageReference,
  PreparedVideoReference,
  VideoProviderAdapter,
  VideoProviderExecutionRequest,
  VideoProviderOutput,
  VideoProviderRequest,
} from '../video-generation.types';
import { HUNYUAN_VIDEO_1_5_MODEL } from '../video-provider.catalog';
import {
  abortableDelay,
  downloadVideo,
  normalizeAspectRatio,
  normalizeModel,
  normalizeResolution,
  providerMaxPolls,
  providerPollIntervalMs,
  responseRecord,
} from './video-provider.util';

const HUNYUAN_BASE_URL = 'https://tokenhub.tencentmaas.com/v1/wand/hunyuan-video';
const SUPPORTED_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);

@Injectable()
export class TencentHunyuanVideoAdapter implements VideoProviderAdapter {
  readonly providerKey = 'hunyuan' as const;

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
      await fetch(`${HUNYUAN_BASE_URL}/generation`, {
        method: 'POST',
        headers: headers(request.credential.apiKey),
        body: JSON.stringify(this.body(request, model)),
        signal: request.signal,
      }),
      'VIDEO_HUNYUAN_CREATE_FAILED',
    );
    const taskId = String(created.task_id ?? '').trim();
    if (!taskId) throw new Error('VIDEO_HUNYUAN_TASK_ID_MISSING');

    const completed = await this.poll(taskId, request);
    const videos = Array.isArray(completed.videos) ? completed.videos : [];
    const first = videos[0] && typeof videos[0] === 'object'
      ? videos[0] as Record<string, any>
      : {};
    const url = String(first.url ?? '').trim();
    if (!url) throw new Error('VIDEO_HUNYUAN_DOWNLOAD_URL_MISSING');

    const buffer = await downloadVideo({ url, signal: request.signal });
    return {
      buffer,
      mimeType: 'video/mp4',
      extension: 'mp4',
      providerKey: this.providerKey,
      model,
      metadata: {
        taskId,
        durationSeconds: 5,
        resolution: '720p',
        aspectRatio: normalizeAspectRatio(request.aspectRatio),
        generatedAudio: false,
      },
    };
  }

  private assertSupported(request: VideoProviderRequest): string {
    const model = normalizeModel(request.model) ?? HUNYUAN_VIDEO_1_5_MODEL;
    if (model !== HUNYUAN_VIDEO_1_5_MODEL) {
      throw new BadRequestException('VIDEO_HUNYUAN_MODEL_UNSUPPORTED');
    }
    if (request.audio === 'required') {
      throw new BadRequestException('VIDEO_HUNYUAN_AUDIO_UNSUPPORTED');
    }
    if (request.references.some((item) => item.mediaType === 'video')) {
      throw new BadRequestException('VIDEO_HUNYUAN_REFERENCE_VIDEO_UNSUPPORTED');
    }

    const firstFrames = request.references.filter(isFirstFrame);
    const otherReferences = request.references.filter((item) => !isFirstFrame(item));
    if (firstFrames.length > 1 || otherReferences.length > 0) {
      throw new BadRequestException('VIDEO_HUNYUAN_REFERENCE_UNSUPPORTED');
    }

    const duration = request.durationSeconds == null ? 5 : Number(request.durationSeconds);
    if (duration !== 5) {
      throw new BadRequestException('VIDEO_HUNYUAN_DURATION_UNSUPPORTED');
    }
    const resolution = normalizeResolution(request.resolution) ?? '720p';
    if (resolution !== '720p') {
      throw new BadRequestException('VIDEO_HUNYUAN_RESOLUTION_UNSUPPORTED');
    }

    const ratio = normalizeAspectRatio(request.aspectRatio);
    if (firstFrames.length > 0 && ratio) {
      throw new BadRequestException('VIDEO_HUNYUAN_IMAGE_ASPECT_RATIO_CONTROL_UNSUPPORTED');
    }
    if (!firstFrames.length && ratio && !SUPPORTED_RATIOS.has(ratio)) {
      throw new BadRequestException('VIDEO_HUNYUAN_ASPECT_RATIO_UNSUPPORTED');
    }
    return model;
  }

  private body(request: VideoProviderRequest, model: string): Record<string, unknown> {
    const firstFrame = request.references.find(isFirstFrame);
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      duration: 5,
      resolution: '720p',
      revise: false,
    };
    if (firstFrame) {
      body.image = firstFrame.buffer.toString('base64');
    } else {
      body.aspect_ratio = normalizeAspectRatio(request.aspectRatio) ?? '16:9';
    }
    return body;
  }

  private async poll(taskId: string, request: VideoProviderExecutionRequest): Promise<Record<string, any>> {
    for (let attempt = 0; attempt < providerMaxPolls(); attempt += 1) {
      const body = await responseRecord(
        await fetch(`${HUNYUAN_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
          headers: { authorization: `Bearer ${request.credential.apiKey}` },
          signal: request.signal,
        }),
        'VIDEO_HUNYUAN_QUERY_FAILED',
      );
      const status = String(body.status ?? '').trim().toLowerCase();
      if (status === 'succeeded') return body;
      if (status === 'failed') {
        const error = body.error && typeof body.error === 'object'
          ? body.error as Record<string, any>
          : {};
        throw new Error(`VIDEO_HUNYUAN_GENERATION_FAILED:${String(error.message ?? '').trim()}`);
      }
      if (status !== 'queued' && status !== 'running') {
        throw new Error(`VIDEO_HUNYUAN_STATUS_UNKNOWN:${status || 'empty'}`);
      }
      await abortableDelay(providerPollIntervalMs(), request.signal);
    }
    throw new Error('VIDEO_HUNYUAN_GENERATION_TIMEOUT');
  }
}

function isFirstFrame(reference: PreparedVideoReference): reference is PreparedVideoImageReference {
  return reference.mediaType === 'image' && reference.role === 'first_frame';
}

function headers(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}
