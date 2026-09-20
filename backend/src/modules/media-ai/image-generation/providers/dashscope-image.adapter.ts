import { Injectable } from '@nestjs/common';
import type {
  ImageGenerationRequest,
  ImageProviderAdapter,
  ImageProviderResult,
} from '../../contracts/image-generation.types';
import {
  materializeProviderImage,
  normalizedOutputSize,
  rasterSizeForAspectRatio,
  requestedOutputSize,
  targetSideForOutputSize,
} from './image-provider.util';

@Injectable()
export class DashScopeImageAdapter implements ImageProviderAdapter {
  readonly kind = 'dashscope_multimodal_image';

  supports(config: ImageGenerationRequest['config']): boolean {
    return config.protocol === 'dashscope_multimodal_image';
  }

  async generate(
    request: ImageGenerationRequest,
  ): Promise<ImageProviderResult> {
    const base = request.config.baseUrl.replace(/\/+$/, '');
    const content = [
      ...request.references.map((image) => ({
        image:
          `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
      })),
      { text: request.prompt },
    ];

    const response = await fetch(
      `${base}/services/aigc/multimodal-generation/generation`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.config.apiKey}`,
          'content-type': 'application/json',
          ...(request.config.headers ?? {}),
        },
        body: JSON.stringify({
          model: request.config.model,
          input: {
            messages: [
              {
                role: 'user',
                content,
              },
            ],
          },
          parameters: buildParameters(request),
        }),
        signal: request.signal,
      },
    );

    const json = await response
      .json()
      .catch(() => ({})) as Record<string, any>;

    if (!response.ok || json.code) {
      const message = String(
        json?.error?.message
        ?? json?.message
        ?? json?.code
        ?? response.statusText,
      );
      throw new Error(
        `IMAGE_GENERATION_PROVIDER_ERROR:${response.status}:${message}`,
      );
    }

    const urls: string[] = [];
    let revisedPrompt: string | null = null;

    for (
      const choice of Array.isArray(json?.output?.choices)
        ? json.output.choices
        : []
    ) {
      for (
        const item of Array.isArray(choice?.message?.content)
          ? choice.message.content
          : []
      ) {
        const url = String(item?.image ?? '').trim();
        if (url) urls.push(url);

        const text = String(item?.text ?? '').trim();
        if (text) revisedPrompt = text;
      }
    }

    const images = await Promise.all(
      urls.map(async (url) => ({
        buffer: await materializeProviderImage({
          url,
          signal: request.signal,
        }),
        mimeType: 'image/png',
      })),
    );

    if (!images.length) {
      throw new Error('IMAGE_GENERATION_EMPTY_RESULT');
    }

    return {
      images: images.slice(0, outputCount(request)),
      revisedPrompt,
      providerMetadata: {
        requestId: json.request_id ?? null,
        usage: json.usage ?? null,
      },
    };
  }
}

function buildParameters(
  request: ImageGenerationRequest,
): Record<string, unknown> {
  switch (request.config.model) {
    case 'wan2.7-image-pro':
    case 'wan2.7-image':
      return {
        n: outputCount(request),
        size: wan27Size(request),
        watermark: false,
      };

    case 'qwen-image-3.0-pro':
    case 'qwen-image-3.0':
      return {
        prompt_extend: false,
        n: outputCount(request),
        size: qwenImage30Size(request),
        watermark: false,
      };

    case 'qwen-image-2.0':
      return {
        prompt_extend: true,
        n: outputCount(request),
        size: qwenImage20Size(request),
        watermark: false,
      };

    case 'z-image-turbo':
      return {
        prompt_extend: false,
        size: zImageSize(request),
        watermark: false,
      };

    default:
      return {
        prompt_extend: true,
        n: outputCount(request),
        size: defaultDashScopeSize(request),
        watermark: false,
      };
  }
}

function outputCount(
  request: ImageGenerationRequest,
): number {
  const requested = Math.max(
    1,
    Math.floor(Number(request.count) || 1),
  );

  if (request.config.model === 'z-image-turbo') {
    return 1;
  }

  if (
    request.config.model === 'qwen-image-3.0-pro'
    || request.config.model === 'qwen-image-3.0'
    || request.config.model === 'qwen-image-2.0'
  ) {
    return Math.min(requested, 6);
  }

  if (
    request.config.model === 'wan2.7-image-pro'
    || request.config.model === 'wan2.7-image'
  ) {
    return Math.min(requested, 4);
  }

  return Math.min(requested, 4);
}

function wan27Size(
  request: ImageGenerationRequest,
): string {
  const isPro = request.config.model === 'wan2.7-image-pro';
  if (!isPro) {
    const size = requestedOutputSize(request, {
      supported: ['1K', '2K'],
      fallbackStandard: '2K',
      fallbackHigh: '2K',
      capAt: '2K',
    });
    const resolved = size === 'auto' ? '2K' : size;
    if (!requestedAspectRatio(request.aspectRatio)) return resolved;
    const side = targetSideForOutputSize(resolved, 2048);
    return rasterSizeForAspectRatio({
      aspectRatio: request.aspectRatio,
      targetArea: side * side,
      maxSide: 2048,
      separator: '*',
      minSide: 768,
    });
  }

  const editing =
    request.references.length > 0
    || Boolean(request.mask);
  const multipleOutputs = outputCount(request) > 1;
  const capAt = editing || multipleOutputs
    ? '2K' as const
    : '4K' as const;
  const size = requestedOutputSize(request, {
    supported: ['1K', '2K', '4K'],
    fallbackStandard: editing || multipleOutputs ? '1K' : '2K',
    fallbackHigh: editing || multipleOutputs ? '2K' : '4K',
    capAt,
  });
  const resolved = size === 'auto'
    ? (editing || multipleOutputs ? '1K' : '2K')
    : size;

  if (!requestedAspectRatio(request.aspectRatio)) {
    return resolved;
  }

  const side = targetSideForOutputSize(
    resolved,
    editing || multipleOutputs ? 1024 : 2048,
  );
  return rasterSizeForAspectRatio({
    aspectRatio: request.aspectRatio,
    targetArea: side * side,
    maxSide: editing || multipleOutputs
      ? 2048
      : 4096,
    separator: '*',
    minSide: 256,
  });
}

function qwenImage30Size(
  request: ImageGenerationRequest,
): string {
  const size = requestedOutputSize(request, {
    supported: ['1K', '2K'],
    fallbackStandard: '1K',
    fallbackHigh: '2K',
    capAt: '2K',
  });
  const resolved = size === 'auto' ? '1K' : size;
  const side = targetSideForOutputSize(resolved, 1024);

  return rasterSizeForAspectRatio({
    aspectRatio: request.aspectRatio,
    targetArea: side * side,
    maxSide: 2048,
    minSide: 512,
    separator: '*',
  });
}

function qwenImage20Size(
  request: ImageGenerationRequest,
): string {
  const size = requestedOutputSize(request, {
    supported: ['1K', '2K'],
    fallbackStandard: '1K',
    fallbackHigh: '2K',
    capAt: '2K',
  });
  const side = targetSideForOutputSize(
    size === 'auto' ? '1K' : size,
    1024,
  );

  return rasterSizeForAspectRatio({
    aspectRatio: request.aspectRatio,
    targetArea: side * side,
    maxSide: size === '2K' ? 2688 : 1536,
    separator: '*',
  });
}

function zImageSize(
  request: ImageGenerationRequest,
): string {
  const explicit = normalizedOutputSize(
    request.outputSize,
  );

  if (explicit === 'auto') {
    const side = request.quality === 'high'
      ? 1536
      : 1280;
    return rasterSizeForAspectRatio({
      aspectRatio: request.aspectRatio,
      targetArea: side * side,
      maxSide: 2048,
      separator: '*',
    });
  }

  const size = requestedOutputSize(request, {
    supported: ['1K', '2K'],
    fallbackStandard: '1K',
    fallbackHigh: '2K',
    capAt: '2K',
  });
  const side = targetSideForOutputSize(
    size === 'auto' ? '1K' : size,
    1280,
  );

  return rasterSizeForAspectRatio({
    aspectRatio: request.aspectRatio,
    targetArea: side * side,
    maxSide: 2048,
    separator: '*',
  });
}

function defaultDashScopeSize(
  request: ImageGenerationRequest,
): string {
  const size = requestedOutputSize(request, {
    fallbackStandard: '1K',
    fallbackHigh: '2K',
    capAt: '2K',
  });
  const resolved = size === 'auto' ? '1K' : size;
  const side = targetSideForOutputSize(
    resolved,
    1024,
  );
  return rasterSizeForAspectRatio({
    aspectRatio: request.aspectRatio,
    targetArea: side * side,
    maxSide: 2048,
    separator: '*',
  });
}

function requestedAspectRatio(
  value: string | null | undefined,
): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return Boolean(
    normalized
    && normalized !== 'auto',
  );
}
