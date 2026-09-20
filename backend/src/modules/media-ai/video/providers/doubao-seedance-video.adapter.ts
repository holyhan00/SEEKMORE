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
  DOUBAO_SEEDANCE_2_FAST_MODEL,
  DOUBAO_SEEDANCE_2_MODEL,
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

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

const SUPPORTED_MODELS = new Set([
  DOUBAO_SEEDANCE_2_MODEL,
  DOUBAO_SEEDANCE_2_FAST_MODEL,
]);

const SUPPORTED_RATIOS = new Set([
  'adaptive',
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
]);

const STANDARD_RESOLUTIONS = new Set([
  '480p',
  '720p',
  '1080p',
  '4k',
]);

const FAST_RESOLUTIONS = new Set([
  '480p',
  '720p',
]);

const MAX_REFERENCE_IMAGES = 9;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

@Injectable()
export class DoubaoSeedanceVideoAdapter implements VideoProviderAdapter {
  readonly providerKey = 'doubao' as const;

  supports(request: VideoProviderRequest): boolean {
    try {
      this.assertSupported(request);
      return true;
    } catch {
      return false;
    }
  }

  async generate(
    request: VideoProviderExecutionRequest,
  ): Promise<VideoProviderOutput> {
    const model = this.assertSupported(request);

    const serializedBody = JSON.stringify(
      this.requestBody(request, model),
    );

    if (
      Buffer.byteLength(serializedBody, 'utf8')
      > MAX_REQUEST_BYTES
    ) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_REQUEST_TOO_LARGE',
      );
    }

    const created = await responseRecord(
      await fetch(
        `${ARK_BASE_URL}/contents/generations/tasks`,
        {
          method: 'POST',
          headers: headers(
            request.credential.apiKey,
          ),
          body: serializedBody,
          signal: request.signal,
        },
      ),
      'VIDEO_SEEDANCE_CREATE_FAILED',
    );

    const taskId = String(
      created.id
        ?? created.task_id
        ?? '',
    ).trim();

    if (!taskId) {
      throw new Error(
        'VIDEO_SEEDANCE_TASK_ID_MISSING',
      );
    }

    const completed = await this.poll(
      taskId,
      request,
    );

    const url = extractVideoUrl(completed);

    const buffer = await downloadVideo({
      url,
      signal: request.signal,
    });

    return {
      buffer,
      mimeType: 'video/mp4',
      extension: 'mp4',
      providerKey: this.providerKey,
      model,
      metadata: {
        taskId,
        durationSeconds:
          request.durationSeconds ?? null,
        resolution: normalizeResolution(
          request.resolution,
        ),
        aspectRatio: normalizeAspectRatio(
          request.aspectRatio,
        ),
        generatedAudio:
          request.audio === 'silent'
            ? false
            : true,
      },
    };
  }

  private assertSupported(
    request: VideoProviderRequest,
  ): string {
    const model =
      normalizeModel(request.model)
      ?? DOUBAO_SEEDANCE_2_MODEL;

    if (!SUPPORTED_MODELS.has(model)) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_MODEL_UNSUPPORTED',
      );
    }

    if (
      request.references.some(
        (reference) =>
          reference.mediaType === 'video',
      )
    ) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_LOCAL_REFERENCE_VIDEO_UNSUPPORTED',
      );
    }

    const firstFrames =
      request.references.filter(
        isFirstFrame,
      );

    const lastFrames =
      request.references.filter(
        isLastFrame,
      );

    const genericImages =
      request.references.filter(
        isGenericImageReference,
      );

    if (
      firstFrames.length > 1
      || lastFrames.length > 1
    ) {
      throw new BadRequestException(
        'VIDEO_REFERENCE_LIMIT_EXCEEDED',
      );
    }

    if (
      lastFrames.length > 0
      && firstFrames.length === 0
    ) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_LAST_FRAME_REQUIRES_FIRST_FRAME',
      );
    }

    if (
      genericImages.length
      > MAX_REFERENCE_IMAGES
    ) {
      throw new BadRequestException(
        'VIDEO_REFERENCE_LIMIT_EXCEEDED',
      );
    }

    if (
      genericImages.length > 0
      && (
        firstFrames.length > 0
        || lastFrames.length > 0
      )
    ) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_REFERENCE_MODE_CONFLICT',
      );
    }

    /*
     * The video-reference check above is a runtime
     * validation, but TypeScript does not narrow the
     * entire request.references array after Array.some().
     *
     * Keep an explicit discriminant check here so the
     * reference is narrowed to PreparedVideoImageReference
     * before passing it to assertImage().
     */
    for (const reference of request.references) {
      if (reference.mediaType !== 'image') {
        throw new BadRequestException(
          'VIDEO_SEEDANCE_LOCAL_REFERENCE_VIDEO_UNSUPPORTED',
        );
      }

      this.assertImage(reference);
    }

    const duration =
      request.durationSeconds == null
        ? 5
        : Number(request.durationSeconds);

    if (
      !Number.isInteger(duration)
      || duration < 4
      || duration > 15
    ) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_DURATION_UNSUPPORTED',
      );
    }

    const ratio = normalizeAspectRatio(
      request.aspectRatio,
    );

    if (
      ratio
      && !SUPPORTED_RATIOS.has(ratio)
    ) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_ASPECT_RATIO_UNSUPPORTED',
      );
    }

    const resolution =
      normalizeSeedanceResolution(
        request.resolution,
      );

    if (resolution) {
      const supported =
        model
        === DOUBAO_SEEDANCE_2_FAST_MODEL
          ? FAST_RESOLUTIONS
          : STANDARD_RESOLUTIONS;

      if (!supported.has(resolution)) {
        throw new BadRequestException(
          'VIDEO_SEEDANCE_RESOLUTION_UNSUPPORTED',
        );
      }

      if (
        genericImages.length > 0
        && resolution === '1080p'
      ) {
        throw new BadRequestException(
          'VIDEO_SEEDANCE_REFERENCE_IMAGE_1080P_UNSUPPORTED',
        );
      }
    }

    return model;
  }

  private requestBody(
    request: VideoProviderRequest,
    model: string,
  ): Record<string, unknown> {
    const content:
      Record<string, unknown>[] = [
        {
          type: 'text',
          text: request.prompt,
        },
      ];

    for (const reference of request.references) {
      if (reference.mediaType !== 'image') {
        continue;
      }

      content.push({
        type: 'image_url',
        image_url: {
          url: base64DataUrl(reference),
        },
        role: seedanceRole(reference),
      });
    }

    return {
      model,
      content,
      duration:
        request.durationSeconds == null
          ? 5
          : Number(
              request.durationSeconds,
            ),
      ...(normalizeAspectRatio(
        request.aspectRatio,
      )
        ? {
            ratio:
              normalizeAspectRatio(
                request.aspectRatio,
              ),
          }
        : {}),
      ...(normalizeSeedanceResolution(
        request.resolution,
      )
        ? {
            resolution:
              normalizeSeedanceResolution(
                request.resolution,
              ),
          }
        : {}),
      ...(request.audio === 'required'
        ? {
            generate_audio: true,
          }
        : request.audio === 'silent'
          ? {
              generate_audio: false,
            }
          : {}),
      watermark: false,
    };
  }

  private assertImage(
    reference: PreparedVideoImageReference,
  ): void {
    if (
      reference.buffer.length
      > MAX_IMAGE_BYTES
    ) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_REFERENCE_TOO_LARGE',
      );
    }

    const ratio =
      reference.width
      / reference.height;

    if (
      reference.width < 300
      || reference.width > 6000
      || reference.height < 300
      || reference.height > 6000
      || ratio <= 0.4
      || ratio >= 2.5
    ) {
      throw new BadRequestException(
        'VIDEO_SEEDANCE_REFERENCE_DIMENSIONS_UNSUPPORTED',
      );
    }
  }

  private async poll(
    taskId: string,
    request: VideoProviderExecutionRequest,
  ): Promise<Record<string, any>> {
    for (
      let attempt = 0;
      attempt < providerMaxPolls();
      attempt += 1
    ) {
      const body = await responseRecord(
        await fetch(
          `${ARK_BASE_URL}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
          {
            headers: {
              authorization:
                `Bearer ${request.credential.apiKey}`,
            },
            signal: request.signal,
          },
        ),
        'VIDEO_SEEDANCE_QUERY_FAILED',
      );

      const status = String(
        body.status
          ?? body.state
          ?? '',
      )
        .trim()
        .toLowerCase();

      if (
        status === 'succeeded'
        || status === 'success'
      ) {
        return body;
      }

      if (
        status === 'failed'
        || status === 'cancelled'
        || status === 'canceled'
        || status === 'expired'
      ) {
        throw new Error(
          `VIDEO_SEEDANCE_GENERATION_${status.toUpperCase()}`,
        );
      }

      if (
        status !== 'queued'
        && status !== 'pending'
        && status !== 'running'
        && status !== 'processing'
      ) {
        throw new Error(
          `VIDEO_SEEDANCE_STATUS_UNKNOWN:${status || 'empty'}`,
        );
      }

      await abortableDelay(
        providerPollIntervalMs(),
        request.signal,
      );
    }

    throw new Error(
      'VIDEO_SEEDANCE_GENERATION_TIMEOUT',
    );
  }
}

function isFirstFrame(
  reference: PreparedVideoReference,
): reference is PreparedVideoImageReference {
  return (
    reference.mediaType === 'image'
    && reference.role === 'first_frame'
  );
}

function isLastFrame(
  reference: PreparedVideoReference,
): reference is PreparedVideoImageReference {
  return (
    reference.mediaType === 'image'
    && reference.role === 'last_frame'
  );
}

function isGenericImageReference(
  reference: PreparedVideoReference,
): reference is PreparedVideoImageReference {
  return (
    reference.mediaType === 'image'
    && (
      reference.role === 'subject'
      || reference.role === 'style'
      || reference.role === 'reference'
    )
  );
}

function seedanceRole(
  reference: PreparedVideoImageReference,
):
  | 'first_frame'
  | 'last_frame'
  | 'reference_image' {
  if (
    reference.role === 'first_frame'
  ) {
    return 'first_frame';
  }

  if (
    reference.role === 'last_frame'
  ) {
    return 'last_frame';
  }

  return 'reference_image';
}

function normalizeSeedanceResolution(
  value: unknown,
): string | null {
  const resolution =
    normalizeResolution(value)
      ?.toLowerCase()
    ?? null;

  if (resolution === '4k') {
    return '4k';
  }

  if (resolution === '1080p') {
    return '1080p';
  }

  if (resolution === '720p') {
    return '720p';
  }

  if (resolution === '480p') {
    return '480p';
  }

  return resolution;
}

function extractVideoUrl(
  body: Record<string, any>,
): string {
  const content =
    body.content
    && typeof body.content === 'object'
      ? body.content as Record<
          string,
          any
        >
      : {};

  const output =
    body.output
    && typeof body.output === 'object'
      ? body.output as Record<
          string,
          any
        >
      : {};

  const url = String(
    content.video_url
      ?? content.url
      ?? output.video_url
      ?? output.url
      ?? body.video_url
      ?? '',
  ).trim();

  if (!url) {
    throw new Error(
      'VIDEO_SEEDANCE_DOWNLOAD_URL_MISSING',
    );
  }

  return url;
}

function headers(
  apiKey: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type':
      'application/json',
  };
}