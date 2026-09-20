import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

const DEFAULT_TARGET_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_LONG_SIDE = 2048;
const DEFAULT_TOTAL_BUDGET_BYTES = 12 * 1024 * 1024;

export type PreparedModelImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp';

export interface PreparedModelImage {
  mimeType: PreparedModelImageMimeType;
  buffer: Buffer;
  width: number;
  height: number;
}

export async function prepareModelImage(input: {
  buffer: Buffer;
  mimeType: string;
  targetBytes?: number;
  maxLongSide?: number;
  forceNormalize?: boolean;
  decodeFailureCode?: string;
  tooLargeCode?: string;
  processorUnavailableCode?: string;
}): Promise<PreparedModelImage> {
  const targetBytes = boundedPositiveInt(
    input.targetBytes,
    modelImageInputTargetBytes(),
    256 * 1024,
    8 * 1024 * 1024,
  );
  const maxLongSide = boundedPositiveInt(
    input.maxLongSide,
    modelImageInputMaxLongSide(),
    768,
    4096,
  );
  const decodeFailureCode =
    input.decodeFailureCode
    ?? 'MODEL_IMAGE_INPUT_DECODE_FAILED';
  const tooLargeCode =
    input.tooLargeCode
    ?? 'MODEL_IMAGE_INPUT_PREPARATION_TOO_LARGE';
  const sharp = loadSharp(
    input.processorUnavailableCode
    ?? 'MODEL_IMAGE_INPUT_PROCESSOR_UNAVAILABLE',
  );
  const metadata = await sharp(input.buffer, {
    failOn: 'none',
    limitInputPixels: 100_000_000,
  }).metadata();
  const sourceWidth = positiveInt(metadata.width);
  const sourceHeight = positiveInt(metadata.height);

  if (!sourceWidth || !sourceHeight) {
    throw new BadRequestException(
      decodeFailureCode,
    );
  }

  const normalizedMimeType = normalizeSupportedMimeType(
    input.mimeType,
  );
  const withinDimensionBudget =
    Math.max(sourceWidth, sourceHeight)
    <= maxLongSide;

  if (
    !input.forceNormalize
    && normalizedMimeType
    && withinDimensionBudget
    && input.buffer.length <= targetBytes
  ) {
    return {
      mimeType: normalizedMimeType,
      buffer: input.buffer,
      width: sourceWidth,
      height: sourceHeight,
    };
  }

  const initialScale = Math.min(
    1,
    maxLongSide
      / Math.max(sourceWidth, sourceHeight),
  );
  const hasAlpha = Boolean(metadata.hasAlpha);
  let last:
    | {
        data: Buffer;
        width: number;
        height: number;
        mimeType: PreparedModelImageMimeType;
      }
    | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const dimensionScale =
      initialScale
      * Math.pow(
        0.88,
        Math.floor(attempt / 2),
      );
    const width = Math.max(
      128,
      Math.round(sourceWidth * dimensionScale),
    );
    const height = Math.max(
      128,
      Math.round(sourceHeight * dimensionScale),
    );
    const quality = Math.max(
      45,
      90 - attempt * 5,
    );

    const pipeline = sharp(input.buffer, {
      failOn: 'none',
      limitInputPixels: 100_000_000,
    }).resize(width, height, {
      fit: 'fill',
      withoutEnlargement: true,
    });

    const result = hasAlpha
      ? await pipeline
          .webp({ quality, effort: 4 })
          .toBuffer({ resolveWithObject: true })
      : await pipeline
          .jpeg({ quality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });

    last = {
      data: result.data,
      width: result.info.width,
      height: result.info.height,
      mimeType: hasAlpha
        ? 'image/webp'
        : 'image/jpeg',
    };

    if (result.data.length <= targetBytes) {
      return {
        mimeType: last.mimeType,
        buffer: result.data,
        width: last.width,
        height: last.height,
      };
    }
  }

  if (!last || last.data.length > targetBytes) {
    throw new BadRequestException(
      tooLargeCode,
    );
  }

  return {
    mimeType: last.mimeType,
    buffer: last.data,
    width: last.width,
    height: last.height,
  };
}

export function modelImageInputTargetBytes(): number {
  return boundedPositiveInt(
    process.env.MODEL_IMAGE_INPUT_TARGET_BYTES,
    DEFAULT_TARGET_BYTES,
    256 * 1024,
    8 * 1024 * 1024,
  );
}

export function modelImageInputMaxSourceBytes(): number {
  return boundedPositiveInt(
    process.env.MODEL_IMAGE_INPUT_MAX_SOURCE_BYTES,
    DEFAULT_MAX_SOURCE_BYTES,
    8 * 1024 * 1024,
    512 * 1024 * 1024,
  );
}

export function modelImageInputMaxLongSide(): number {
  return boundedPositiveInt(
    process.env.MODEL_IMAGE_INPUT_MAX_LONG_SIDE,
    DEFAULT_MAX_LONG_SIDE,
    768,
    4096,
  );
}

export function modelImageInputTotalBudgetBytes(): number {
  return boundedPositiveInt(
    process.env.MODEL_IMAGE_INPUT_TOTAL_BUDGET_BYTES,
    DEFAULT_TOTAL_BUDGET_BYTES,
    2 * 1024 * 1024,
    64 * 1024 * 1024,
  );
}

function normalizeSupportedMimeType(
  value: unknown,
): PreparedModelImageMimeType | null {
  const mime = String(value ?? '')
    .trim()
    .toLowerCase();

  if (mime === 'image/png') {
    return 'image/png';
  }
  if (
    mime === 'image/jpeg'
    || mime === 'image/jpg'
  ) {
    return 'image/jpeg';
  }
  if (mime === 'image/webp') {
    return 'image/webp';
  }
  return null;
}

function loadSharp(
  unavailableCode: string,
): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require('sharp');
    return loaded?.default ?? loaded;
  } catch {
    throw new InternalServerErrorException(
      unavailableCode,
    );
  }
}

function positiveInt(
  value: unknown,
): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    && parsed > 0
    ? Math.floor(parsed)
    : null;
}

function boundedPositiveInt(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed =
    positiveInt(value)
    ?? fallback;
  return Math.max(
    minimum,
    Math.min(maximum, parsed),
  );
}
