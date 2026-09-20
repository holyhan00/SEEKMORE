import { Injectable } from '@nestjs/common';
import type {
  ImageGenerationRequest,
  ImageProviderAdapter,
  ImageProviderOutput,
  ImageProviderResult,
} from '../../contracts/image-generation.types';
import { requestedOutputSize } from './image-provider.util';

@Injectable()
export class GeminiInteractionsImageAdapter implements ImageProviderAdapter {
  readonly kind = 'gemini_interactions_image';

  supports(config: ImageGenerationRequest['config']): boolean {
    return config.protocol === 'gemini_interactions_image';
  }

  async generate(request: ImageGenerationRequest): Promise<ImageProviderResult> {
    const outputs: ImageProviderOutput[] = [];
    let revisedPrompt: string | null = null;

                                                                              
                                                                              
    for (let index = 0; index < request.count; index += 1) {
      const result = await this.generateOne(request);
      outputs.push(result.image);
      revisedPrompt ??= result.revisedPrompt;
    }

    return { images: outputs, revisedPrompt };
  }

  private async generateOne(request: ImageGenerationRequest): Promise<{
    image: ImageProviderOutput;
    revisedPrompt: string | null;
  }> {
    const base = request.config.baseUrl.replace(/\/+$/, '');
    const input = request.references.length
      ? [
          { type: 'text', text: request.prompt },
          ...request.references.map((image) => ({
            type: 'image',
            mime_type: image.mimeType,
            data: image.buffer.toString('base64'),
          })),
        ]
      : request.prompt;

    const response = await fetch(`${base}/interactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': request.config.apiKey,
        ...(request.config.headers ?? {}),
      },
      body: JSON.stringify({
        model: request.config.model,
        input,
        response_format: {
          type: 'image',
          mime_type: outputMimeType(request.outputFormat),
          ...(geminiAspectRatio(request.aspectRatio)
            ? { aspect_ratio: geminiAspectRatio(request.aspectRatio) }
            : {}),
          image_size: imageSize(request),
        },
      }),
      signal: request.signal,
    });

    const json = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`IMAGE_GENERATION_PROVIDER_ERROR:${response.status}:${providerMessage(json, response.statusText)}`);
    }

    const image = extractImage(json);
    if (!image) throw new Error('IMAGE_GENERATION_EMPTY_RESULT');
    return {
      image,
      revisedPrompt: stringOrNull(json.output_text ?? json.outputText),
    };
  }
}

function imageSize(request: ImageGenerationRequest): string {
  const resolved = requestedOutputSize(request, {
    fallbackStandard: '1K',
    fallbackHigh: '2K',
  });
  return resolved === 'auto' ? '1K' : resolved;
}

function outputMimeType(format: ImageGenerationRequest['outputFormat']): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/png';
  return 'image/png';
}

function extractImage(value: unknown): ImageProviderOutput | null {
  const seen = new Set<unknown>();
  const visit = (node: unknown): ImageProviderOutput | null => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    const record = node as Record<string, unknown>;
    const type = String(record.type ?? '').toLowerCase();
    const data = String(record.data ?? '').trim();
    const mimeType = String(record.mime_type ?? record.mimeType ?? '').trim();
    if (data && (type === 'image' || mimeType.startsWith('image/'))) {
      return {
        buffer: Buffer.from(data, 'base64'),
        mimeType: mimeType || 'image/png',
      };
    }
    for (const key of ['output_image', 'outputImage', 'output', 'outputs', 'steps', 'content', 'parts']) {
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = visit(item);
          if (found) return found;
        }
      } else {
        const found = visit(child);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(value);
}

function providerMessage(json: Record<string, unknown>, fallback: string): string {
  const error = json.error && typeof json.error === 'object'
    ? json.error as Record<string, unknown>
    : {};
  return String(error.message ?? error.code ?? json.message ?? fallback);
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function geminiAspectRatio(value: string | null | undefined): string | null {
  const ratio = String(value ?? '').trim().toLowerCase();
  if (!ratio) return null;
  if (ratio === 'square') return '1:1';
  if (ratio === 'portrait') return '2:3';
  if (ratio === 'landscape') return '3:2';
  const supported = new Set([
    '1:1', '1:4', '4:1', '1:8', '8:1',
    '2:3', '3:2', '3:4', '4:3', '4:5', '5:4',
    '9:16', '16:9', '21:9',
  ]);
  return supported.has(ratio) ? ratio : null;
}
