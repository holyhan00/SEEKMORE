import { Injectable } from '@nestjs/common';
import type {
  ImageGenerationRequest,
  ImageProviderAdapter,
  ImageProviderResult,
} from '../../contracts/image-generation.types';
import {
  normalizedOutputSize,
  requestedOutputSize,
} from './image-provider.util';

@Injectable()
export class GeminiImageAdapter implements ImageProviderAdapter {
  readonly kind = 'gemini_image';

  supports(config: ImageGenerationRequest['config']): boolean {
    return config.protocol === 'gemini_image';
  }

  async generate(request: ImageGenerationRequest): Promise<ImageProviderResult> {
    const base = request.config.baseUrl.replace(/\/+$/, '');
    const model = encodeURIComponent(request.config.model.replace(/^models\//, ''));
    const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
    for (const image of request.references) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.buffer.toString('base64') } });
    }
    if (request.mask) {
      parts.push({ inlineData: { mimeType: request.mask.mimeType, data: request.mask.buffer.toString('base64') } });
    }
    const response = await fetch(`${base}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': request.config.apiKey,
        ...(request.config.headers ?? {}),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          candidateCount: request.count,
          ...((geminiAspectRatio(request.aspectRatio) || geminiImageSize(request))
            ? {
                responseFormat: {
                  image: {
                    ...(geminiAspectRatio(request.aspectRatio)
                      ? { aspectRatio: geminiAspectRatio(request.aspectRatio) }
                      : {}),
                    ...(geminiImageSize(request)
                      ? { imageSize: geminiImageSize(request) }
                      : {}),
                  },
                },
              }
            : {}),
        },
      }),
      signal: request.signal,
    });
    const json = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) {
      const message = String(json?.error?.message ?? json?.message ?? response.statusText);
      throw new Error(`IMAGE_GENERATION_PROVIDER_ERROR:${response.status}:${message}`);
    }
    const outputs: Array<{ buffer: Buffer; mimeType: string }> = [];
    let revisedPrompt: string | null = null;
    for (const candidate of Array.isArray(json.candidates) ? json.candidates : []) {
      for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
        if (typeof part?.text === 'string' && !revisedPrompt) revisedPrompt = part.text;
        const inline = part?.inlineData ?? part?.inline_data;
        if (inline?.data) {
          outputs.push({
            buffer: Buffer.from(String(inline.data), 'base64'),
            mimeType: String(inline.mimeType ?? inline.mime_type ?? 'image/png'),
          });
        }
      }
    }
    if (!outputs.length) throw new Error('IMAGE_GENERATION_EMPTY_RESULT');
    return { images: outputs.slice(0, request.count), revisedPrompt };
  }
}

function geminiAspectRatio(value: string | null | undefined): string | null {
  const ratio = String(value ?? '').trim().toLowerCase();
  if (!ratio || ratio === 'square') return ratio === 'square' ? '1:1' : null;
  if (ratio === 'portrait') return '2:3';
  if (ratio === 'landscape') return '3:2';
  const supported = new Set([
    '1:1',
    '2:3',
    '3:2',
    '3:4',
    '4:3',
    '4:5',
    '5:4',
    '9:16',
    '16:9',
    '21:9',
  ]);
  return supported.has(ratio) ? ratio : null;
}

function geminiImageSize(request: ImageGenerationRequest): string | null {
  if (normalizedOutputSize(request.outputSize) === 'auto') {
    return null;
  }

  const size = requestedOutputSize(request, {
    fallbackStandard: '1K',
    fallbackHigh: '2K',
  });
  return size === 'auto' ? null : size;
}
