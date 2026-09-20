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
  targetSideForOutputSize,
} from './image-provider.util';

@Injectable()
export class ArkImagesAdapter implements ImageProviderAdapter {
  readonly kind = 'ark_images';

  supports(config: ImageGenerationRequest['config']): boolean {
    return config.protocol === 'ark_images';
  }

  async generate(request: ImageGenerationRequest): Promise<ImageProviderResult> {
    const base = request.config.baseUrl.replace(/\/+$/, '');
    const imageInputs = request.references.map((image) =>
      `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
    );
    const response = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.config.apiKey}`,
        'content-type': 'application/json',
        ...(request.config.headers ?? {}),
      },
      body: JSON.stringify({
        model: request.config.model,
        prompt: request.prompt,
        ...(imageInputs.length === 1
          ? { image: imageInputs[0] }
          : imageInputs.length > 1
            ? { image: imageInputs }
            : {}),
        size: arkSize(request),
        n: request.count,
        response_format: 'b64_json',
        watermark: false,
      }),
      signal: request.signal,
    });
    const json = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) {
      const message = String(json?.error?.message ?? json?.error?.code ?? json?.message ?? response.statusText);
      throw new Error(`IMAGE_GENERATION_PROVIDER_ERROR:${response.status}:${message}`);
    }
    const rows = Array.isArray(json.data) ? json.data : [];
    const images = await Promise.all(rows.map(async (row) => ({
      buffer: await materializeProviderImage({
        b64: row?.b64_json,
        url: row?.url,
        signal: request.signal,
      }),
      mimeType: String(row?.mime_type ?? row?.mimeType ?? 'image/jpeg'),
    })));
    if (!images.length) throw new Error('IMAGE_GENERATION_EMPTY_RESULT');
    return {
      images: images.slice(0, request.count),
      providerMetadata: { usage: json.usage ?? null },
    };
  }
}

function arkSize(
  request: ImageGenerationRequest,
): string {
  const outputSize = normalizedOutputSize(
    request.outputSize,
  );
  const side = outputSize === 'auto'
    ? request.quality === 'high'
      ? 3072
      : 2048
    : targetSideForOutputSize(
        outputSize,
        2048,
      );
  return rasterSizeForAspectRatio({
    aspectRatio: request.aspectRatio,
    targetArea: side * side,
    maxSide: 4096,
    separator: 'x',
  });
}
