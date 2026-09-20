import { Injectable } from '@nestjs/common';
import type {
  ImageGenerationRequest,
  ImageProviderAdapter,
  ImageProviderOutput,
  ImageProviderResult,
} from '../../contracts/image-generation.types';
import {
  closestSupportedAspectRatio,
  materializeProviderImage,
  requestedOutputSize,
} from './image-provider.util';

@Injectable()
export class XaiImagesAdapter implements ImageProviderAdapter {
  readonly kind = 'xai_images';

  supports(config: ImageGenerationRequest['config']): boolean {
    return config.protocol === 'xai_images';
  }

  async generate(request: ImageGenerationRequest): Promise<ImageProviderResult> {
    const editing = request.references.length > 0;
    if (editing) {
      const images: ImageProviderOutput[] = [];
      for (let index = 0; index < request.count; index += 1) {
        images.push(...await this.requestImages(request, true, 1));
      }
      return { images: images.slice(0, request.count) };
    }
    return { images: await this.requestImages(request, false, request.count) };
  }

  private async requestImages(
    request: ImageGenerationRequest,
    editing: boolean,
    count: number,
  ): Promise<ImageProviderOutput[]> {
    const base = request.config.baseUrl.replace(/\/+$/, '');
    const dataUris = request.references.map((image) =>
      `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
    );
    const response = await fetch(`${base}/images/${editing ? 'edits' : 'generations'}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.config.apiKey}`,
        'content-type': 'application/json',
        ...(request.config.headers ?? {}),
      },
      body: JSON.stringify({
        model: request.config.model,
        prompt: request.prompt,
        ...(editing
          ? dataUris.length === 1
            ? { image: { type: 'image_url', url: dataUris[0] } }
            : { images: dataUris.map((url) => ({ type: 'image_url', url })) }
          : { n: count }),
        ...(xaiAspectRatio(request.aspectRatio) ? { aspect_ratio: xaiAspectRatio(request.aspectRatio) } : {}),
        resolution: xaiResolution(request),
        response_format: 'b64_json',
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
      mimeType: inferMimeType(row),
    })));
    if (!images.length) throw new Error('IMAGE_GENERATION_EMPTY_RESULT');
    return images;
  }
}

function inferMimeType(row: Record<string, unknown>): string {
  const mime = String(row?.mime_type ?? row?.mimeType ?? '').trim();
  return mime.startsWith('image/') ? mime : 'image/jpeg';
}

function xaiAspectRatio(
  value: string | null | undefined,
): string | null {
  return closestSupportedAspectRatio(
    value,
    [
      '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
      '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20', 'auto',
    ],
  );
}

function xaiResolution(request: ImageGenerationRequest): '1k' | '2k' {
  const size = requestedOutputSize(request, {
    supported: ['1K', '2K'],
    fallbackStandard: '1K',
    fallbackHigh: '2K',
    capAt: '2K',
  });
  return size === '2K' ? '2k' : '1k';
}
