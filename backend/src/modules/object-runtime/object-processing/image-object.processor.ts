import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ObjectMediaMetadata,
  ObjectProcessingInput,
  ObjectProcessingResult,
  ObjectProcessor,
} from './object-processor.types';

@Injectable()
export class ImageObjectProcessor implements ObjectProcessor {
  readonly name = 'image';

  supports(kind: ObjectProcessingInput['objectKind']): boolean {
    return kind === 'image';
  }

  async process(input: ObjectProcessingInput): Promise<ObjectProcessingResult> {
    const media = readImageMetadata(input.buffer);
    const declared = normalizeImageFormat(input.mimeType, input.extension);
    if (!declared || declared !== media.format) {
      throw new BadRequestException('IMAGE_INPUT_UNSUPPORTED_FORMAT');
    }

    return {
      processor: 'image',
      processorVersion: '1.0.0',
      capabilities: ['inspect', 'view', 'download', 'vision_input', 'image_edit_source'],
      contentSummary: null,
      parsedContent: null,
      media,
      metadata: {
        decodedAt: new Date().toISOString(),
      },
    };
  }
}

export function readImageMetadata(buffer: Buffer): ObjectMediaMetadata & {
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
} {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw new BadRequestException('IMAGE_DECODE_FAILED');
  }
  if (isPng(buffer)) return readPng(buffer);
  if (isJpeg(buffer)) return readJpeg(buffer);
  if (isWebp(buffer)) return readWebp(buffer);
  throw new BadRequestException('IMAGE_INPUT_UNSUPPORTED_FORMAT');
}

function normalizeImageFormat(mimeType: string, extension: string): 'png' | 'jpeg' | 'webp' | null {
  const mime = String(mimeType ?? '').trim().toLowerCase();
  const ext = String(extension ?? '').trim().toLowerCase().replace(/^\./, '');
  if (mime === 'image/png' || ext === 'png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg' || ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (mime === 'image/webp' || ext === 'webp') return 'webp';
  return null;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function readPng(buffer: Buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  assertDimensions(width, height);
  return {
    width,
    height,
    format: 'png' as const,
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

function isJpeg(buffer: Buffer): boolean {
  return buffer[0] === 0xff && buffer[1] === 0xd8;
}

function readJpeg(buffer: Buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (isSofMarker(marker) && length >= 7) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      assertDimensions(width, height);
      return { width, height, format: 'jpeg' as const, hasAlpha: false };
    }
    offset += length;
  }
  throw new BadRequestException('IMAGE_DECODE_FAILED');
}

function isSofMarker(marker: number): boolean {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
}

function isWebp(buffer: Buffer): boolean {
  return buffer.length >= 30
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
}

function readWebp(buffer: Buffer) {
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const flags = buffer[20];
    const width = 1 + readUInt24LE(buffer, 24);
    const height = 1 + readUInt24LE(buffer, 27);
    assertDimensions(width, height);
    return { width, height, format: 'webp' as const, hasAlpha: Boolean(flags & 0x10) };
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const actualWidth = 1 + (b0 | ((b1 & 0x3f) << 8));
    const actualHeight = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
    assertDimensions(actualWidth, actualHeight);
    return {
      width: actualWidth,
      height: actualHeight,
      format: 'webp' as const,
      hasAlpha: Boolean(b3 & 0x10),
    };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    for (let offset = 20; offset + 10 <= buffer.length; offset += 1) {
      if (buffer[offset + 3] === 0x9d && buffer[offset + 4] === 0x01 && buffer[offset + 5] === 0x2a) {
        const width = buffer.readUInt16LE(offset + 6) & 0x3fff;
        const height = buffer.readUInt16LE(offset + 8) & 0x3fff;
        assertDimensions(width, height);
        return { width, height, format: 'webp' as const, hasAlpha: false };
      }
    }
  }
  throw new BadRequestException('IMAGE_DECODE_FAILED');
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 100_000 || height > 100_000) {
    throw new BadRequestException('IMAGE_DECODE_FAILED');
  }
}
