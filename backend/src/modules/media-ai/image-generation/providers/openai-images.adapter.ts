import { Injectable } from '@nestjs/common';
import type {
  ImageGenerationRequest,
  ImageProviderAdapter,
  ImageProviderResult,
} from '../../contracts/image-generation.types';
import { materializeProviderImage, openAiImageSize } from './image-provider.util';

@Injectable()
export class OpenAiImagesAdapter implements ImageProviderAdapter {
  readonly kind = 'openai_images';

  supports(config: ImageGenerationRequest['config']): boolean {
    return config.protocol === 'openai_images';
  }

  async generate(request: ImageGenerationRequest): Promise<ImageProviderResult> {
    const base = request.config.baseUrl.replace(/\/+$/, '');
    const editing = request.references.length > 0 || Boolean(request.mask);
    const url = `${base}/images/${editing ? 'edits' : 'generations'}`;
    const response = editing
      ? await this.edit(url, request)
      : await this.create(url, request);
    const json = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) {
      const message = String(json?.error?.message ?? json?.message ?? response.statusText);
      throw new Error(`IMAGE_GENERATION_PROVIDER_ERROR:${response.status}:${message}`);
    }
    const rows = Array.isArray(json.data) ? json.data : [];
    const images = await Promise.all(rows.map(async (row) => ({
      buffer: await materializeProviderImage({
        b64: row?.b64_json,
        url: row?.url,
        signal: request.signal,
      }),
      mimeType: mimeForFormat(request.outputFormat),
    })));
    if (!images.length) throw new Error('IMAGE_GENERATION_EMPTY_RESULT');
    return {
      images,
      revisedPrompt: String(rows[0]?.revised_prompt ?? '').trim() || null,
    };
  }

  private create(url: string, request: ImageGenerationRequest): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.config.apiKey}`,
        'content-type': 'application/json',
        ...(request.config.headers ?? {}),
      },
      body: JSON.stringify({
        model: request.config.model,
        prompt: request.prompt,
        n: request.count,
        size: openAiImageSize(request),
        quality: request.quality === 'high' ? 'high' : 'medium',
        output_format: request.outputFormat === 'jpeg' ? 'jpeg' : request.outputFormat,
      }),
      signal: request.signal,
    });
  }

  private async edit(url: string, request: ImageGenerationRequest): Promise<Response> {
    const form = new FormData();
    form.set('model', request.config.model);
    form.set('prompt', request.prompt);
    form.set('n', String(request.count));
    form.set('size', openAiImageSize(request));
    form.set('quality', request.quality === 'high' ? 'high' : 'medium');
    form.set('output_format', request.outputFormat);
    for (const [index, image] of request.references.entries()) {
      form.append('image[]', new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), `source-${index}.${extension(image.mimeType)}`);
    }
    if (request.mask) {
      form.set('mask', new Blob([new Uint8Array(request.mask.buffer)], { type: request.mask.mimeType }), `mask.${extension(request.mask.mimeType)}`);
    }
    return fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.config.apiKey}`,
        ...(request.config.headers ?? {}),
      },
      body: form,
      signal: request.signal,
    });
  }
}

function mimeForFormat(format: ImageGenerationRequest['outputFormat']): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}
function extension(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'png';
}
