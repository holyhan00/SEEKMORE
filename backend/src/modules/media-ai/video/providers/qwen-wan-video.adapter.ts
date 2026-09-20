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
  QWEN_WAN_3_MODEL,
  QWEN_WAN_3_PRIME_MODEL,
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

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const SUPPORTED_MODELS = new Set([QWEN_WAN_3_MODEL, QWEN_WAN_3_PRIME_MODEL]);
const SUPPORTED_RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']);
const SUPPORTED_RESOLUTIONS = new Set(['480P', '720P', '1080P']);

@Injectable()
export class QwenWanVideoAdapter implements VideoProviderAdapter {
  readonly providerKey = 'qwen' as const;

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
      await fetch(`${DASHSCOPE_BASE_URL}/services/aigc/video-generation/video-synthesis`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.credential.apiKey}`,
          'content-type': 'application/json',
          'x-dashscope-async': 'enable',
        },
        body: JSON.stringify(this.body(request, model)),
        signal: request.signal,
      }),
      'VIDEO_QWEN_CREATE_FAILED',
    );

    const taskId = String(created?.output?.task_id ?? '').trim();
    if (!taskId) throw new Error('VIDEO_QWEN_TASK_ID_MISSING');

    const completed = await this.poll(taskId, request);
    const url = String(completed?.output?.video_url ?? '').trim();
    if (!url) throw new Error('VIDEO_QWEN_RESULT_URL_MISSING');

    return {
      buffer: await downloadVideo({ url, signal: request.signal }),
      mimeType: 'video/mp4',
      extension: 'mp4',
      providerKey: this.providerKey,
      model,
      metadata: {
        requestId: completed.request_id ?? created.request_id ?? null,
        taskId,
        usage: completed.usage ?? null,
      },
    };
  }

  private assertSupported(request: VideoProviderRequest): string {
    const model = normalizeModel(request.model);
    if (!model || !SUPPORTED_MODELS.has(model)) {
      throw new BadRequestException('VIDEO_QWEN_MODEL_UNSUPPORTED');
    }

    const prompt = String(request.prompt ?? '').trim();
    if (!prompt || prompt.length > 20_000) {
      throw new BadRequestException('VIDEO_QWEN_PROMPT_INVALID');
    }

    if (request.references.some((item) => item.mediaType === 'video')) {
      throw new BadRequestException('VIDEO_QWEN_REFERENCE_VIDEO_REQUIRES_PUBLIC_URL');
    }

    const first = request.references.filter((item) => item.role === 'first_frame');
    const last = request.references.filter((item) => item.role === 'last_frame');
    const generic = request.references.filter(isReferenceImage);
    if (first.length > 1 || last.length > 1 || generic.length > 10) {
      throw new BadRequestException('VIDEO_REFERENCE_LIMIT_EXCEEDED');
    }
    if (last.length > 0 && first.length === 0) {
      throw new BadRequestException('VIDEO_LAST_FRAME_REQUIRES_FIRST_FRAME');
    }
    if ((first.length > 0 || last.length > 0) && generic.length > 0) {
      throw new BadRequestException('VIDEO_QWEN_REFERENCE_MODE_CONFLICT');
    }

    for (const reference of request.references) {
      if (reference.mediaType !== 'image') continue;
      this.assertImage(reference);
    }

    const duration = request.durationSeconds == null ? 5 : Number(request.durationSeconds);
    if (!Number.isInteger(duration) || duration < 2 || duration > 30) {
      throw new BadRequestException('VIDEO_QWEN_DURATION_UNSUPPORTED');
    }

    const resolution = normalizeWanResolution(request.resolution);
    if (resolution && !SUPPORTED_RESOLUTIONS.has(resolution)) {
      throw new BadRequestException('VIDEO_QWEN_RESOLUTION_UNSUPPORTED');
    }

    const ratio = normalizeWanRatio(request.aspectRatio);
    if (ratio && !SUPPORTED_RATIOS.has(ratio)) {
      throw new BadRequestException('VIDEO_QWEN_ASPECT_RATIO_UNSUPPORTED');
    }

    return model;
  }

  private body(request: VideoProviderRequest, model: string): Record<string, unknown> {
    const media = request.references
      .filter((item): item is PreparedVideoImageReference => item.mediaType === 'image')
      .map((reference) => ({
        type: mediaType(reference),
        url: base64DataUrl(reference),
      }));

    const parameters: Record<string, unknown> = {
      resolution: normalizeWanResolution(request.resolution) ?? '1080P',
      ratio: normalizeWanRatio(request.aspectRatio) ?? 'adaptive',
      duration: request.durationSeconds == null ? 5 : Number(request.durationSeconds),
      prompt_extend: false,
      watermark: false,
    };
    if (request.audio === 'required') parameters.audio = true;
    if (request.audio === 'silent') parameters.audio = false;

    return {
      model,
      input: {
        prompt: request.prompt,
        ...(media.length > 0 ? { media } : {}),
      },
      parameters,
    };
  }

  private assertImage(reference: PreparedVideoImageReference): void {
    if (reference.buffer.length > 20 * 1024 * 1024) {
      throw new BadRequestException('VIDEO_QWEN_REFERENCE_IMAGE_TOO_LARGE');
    }
    const ratio = reference.width / reference.height;
    if (
      reference.width < 240
      || reference.width > 8000
      || reference.height < 240
      || reference.height > 8000
      || ratio > 8
      || ratio < 1 / 8
    ) {
      throw new BadRequestException('VIDEO_QWEN_REFERENCE_IMAGE_DIMENSIONS_UNSUPPORTED');
    }
  }

  private async poll(
    taskId: string,
    request: VideoProviderExecutionRequest,
  ): Promise<Record<string, any>> {
    for (let attempt = 0; attempt < providerMaxPolls(); attempt += 1) {
      const body = await responseRecord(
        await fetch(`${DASHSCOPE_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
          headers: { authorization: `Bearer ${request.credential.apiKey}` },
          signal: request.signal,
        }),
        'VIDEO_QWEN_QUERY_FAILED',
      );
      const status = String(body?.output?.task_status ?? '').trim().toUpperCase();
      if (status === 'SUCCEEDED') return body;
      if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
        const message = String(body?.output?.message ?? body?.message ?? status).trim();
        throw new Error(`VIDEO_QWEN_GENERATION_${status}:${message}`);
      }
      if (status !== 'PENDING' && status !== 'RUNNING') {
        throw new Error(`VIDEO_QWEN_STATUS_UNKNOWN:${status || 'EMPTY'}`);
      }
      await abortableDelay(providerPollIntervalMs(), request.signal);
    }
    throw new Error('VIDEO_QWEN_GENERATION_TIMEOUT');
  }
}

function isReferenceImage(
  reference: PreparedVideoReference,
): reference is PreparedVideoImageReference {
  return reference.mediaType === 'image'
    && (reference.role === 'subject'
      || reference.role === 'style'
      || reference.role === 'reference');
}

function mediaType(reference: PreparedVideoImageReference): 'first_frame' | 'last_frame' | 'reference_image' {
  if (reference.role === 'first_frame') return 'first_frame';
  if (reference.role === 'last_frame') return 'last_frame';
  return 'reference_image';
}

function normalizeWanResolution(value: unknown): string | null {
  const normalized = normalizeResolution(value)?.toUpperCase() ?? null;
  if (normalized === '480P' || normalized === '720P' || normalized === '1080P') {
    return normalized;
  }
  return normalized;
}

function normalizeWanRatio(value: unknown): string | null {
  const normalized = normalizeAspectRatio(value)?.toLowerCase() ?? null;
  return normalized;
}
