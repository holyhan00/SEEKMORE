import { Injectable } from '@nestjs/common';
import sharp = require('sharp');
import { RuntimeObjectService } from '../../../modules/object-runtime/object/object.service';
import type { ToolContext } from '../../toolstypes';
import type {
  PresentationElementContent,
  PresentationImageContent,
  PresentationSlideSpec,
} from './presentation.types';
import { PresentationRenderError } from './presentation-render.errors';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

interface NormalizedImage {
  dataBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
  widthPx: number;
  heightPx: number;
}

@Injectable()
export class PresentationAssetResolverService {
  constructor(private readonly objects: RuntimeObjectService) {}

  async resolveSlides(
    slides: PresentationSlideSpec[],
    context: ToolContext,
  ): Promise<PresentationSlideSpec[]> {
    const clone = JSON.parse(JSON.stringify(slides)) as PresentationSlideSpec[];
    const cache = new Map<string, NormalizedImage>();

    for (const slide of clone) {
      for (const element of slide.scene.elements) {
        await this.resolveElementAssets(element, context, cache);
      }
    }
    return clone;
  }

  private async resolveElementAssets(
    element: PresentationElementContent,
    context: ToolContext,
    cache: Map<string, NormalizedImage>,
  ): Promise<void> {
    if (element.type === 'group') {
      for (const child of element.children) await this.resolveElementAssets(child, context, cache);
      return;
    }
    if (element.type !== 'image') return;
    const normalized = await this.resolveImage(element, context, cache);
    element.dataBase64 = normalized.dataBase64;
    element.mimeType = normalized.mimeType;
    element.widthPx = normalized.widthPx;
    element.heightPx = normalized.heightPx;
  }

  private async resolveImage(
    element: PresentationImageContent,
    context: ToolContext,
    cache: Map<string, NormalizedImage>,
  ): Promise<NormalizedImage> {
    const objectId = String(element.objectId ?? '').trim();
    if (objectId) {
      const cached = cache.get(objectId);
      if (cached) return cached;
      const partition = this.partition(context, objectId);
      const { object, buffer } = await this.objects.readBuffer(partition, objectId, MAX_IMAGE_BYTES);
      if (String(object.objectKind ?? '') !== 'image') {
        throw this.error(
          'PRESENTATION_IMAGE_OBJECT_KIND_INVALID',
          `RuntimeObject ${objectId} is not an image.`,
          { objectId, objectKind: object.objectKind },
        );
      }
      const normalized = await this.normalize(buffer, objectId);
      cache.set(objectId, normalized);
      return normalized;
    }

    const encoded = String(element.dataBase64 ?? '').trim();
    if (!encoded) {
      throw this.error('PRESENTATION_IMAGE_SOURCE_REQUIRED', 'Image requires objectId or dataBase64.', { elementId: element.id });
    }
    const buffer = this.decodeInline(encoded, element.id);
    return this.normalize(buffer, element.id);
  }

  private async normalize(buffer: Buffer, identity: string): Promise<NormalizedImage> {
    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      throw this.error('PRESENTATION_IMAGE_BYTES_INVALID', 'Image bytes are empty or exceed the supported size.', { identity, bytes: buffer?.byteLength ?? 0 });
    }

    try {
      const input = sharp(buffer, { animated: false, failOn: 'error' });
      const metadata = await input.metadata();
      const width = Number(metadata.width);
      const height = Number(metadata.height);
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error('decoded image dimensions are invalid');
      }

      const keepJpeg = metadata.format === 'jpeg' && metadata.hasAlpha !== true;
      const output = keepJpeg
        ? await sharp(buffer, { failOn: 'error' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
        : await sharp(buffer, { failOn: 'error' }).png({ compressionLevel: 7 }).toBuffer();
      const outputMetadata = await sharp(output, { failOn: 'error' }).metadata();
      const widthPx = Number(outputMetadata.width);
      const heightPx = Number(outputMetadata.height);
      if (!Number.isFinite(widthPx) || widthPx <= 0 || !Number.isFinite(heightPx) || heightPx <= 0) {
        throw new Error('normalized image dimensions are invalid');
      }
      const mimeType = keepJpeg ? 'image/jpeg' as const : 'image/png' as const;
      return {
        dataBase64: `data:${mimeType};base64,${output.toString('base64')}`,
        mimeType,
        widthPx,
        heightPx,
      };
    } catch (error) {
      throw this.error(
        'PRESENTATION_IMAGE_DECODE_FAILED',
        'Image could not be decoded and normalized for PPTX output.',
        { identity, message: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private decodeInline(value: string, identity: string): Buffer {
    const dataUri = /^data:[^;]+;base64,(.+)$/s.exec(value);
    const encoded = (dataUri?.[1] ?? value).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw this.error('PRESENTATION_IMAGE_BASE64_INVALID', 'Inline image data is not valid base64.', { identity });
    }
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.byteLength === 0) {
      throw this.error('PRESENTATION_IMAGE_BASE64_INVALID', 'Inline image data decoded to an empty buffer.', { identity });
    }
    return buffer;
  }

  private partition(context: ToolContext, objectId: string): {
    userId: string;
    agentId: string;
    conversationId: string;
  } {
    const userId = String(context.userId ?? '').trim();
    const agentId = String(context.metadata?.agentId ?? '').trim();
    const conversationId = String(context.conversationId ?? '').trim();
    if (!userId || !agentId || !conversationId) {
      throw this.error(
        'PRESENTATION_IMAGE_OBJECT_CONTEXT_REQUIRED',
        'Resolving presentation image objectIds requires userId, agentId, and conversationId.',
        { objectId },
      );
    }
    return { userId, agentId, conversationId };
  }

  private error(code: string, message: string, detail: Record<string, unknown>): PresentationRenderError {
    return new PresentationRenderError(
      code,
      message,
      'validation',
      [{ stage: 'validation', code, message, severity: 'error', repairable: false, detail }],
      false,
    );
  }
}
