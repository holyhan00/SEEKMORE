import type {
  ImageGenerationRequest,
  ImageOutputSize,
} from '../../contracts/image-generation.types';

export async function materializeProviderImage(input: {
  b64?: unknown;
  url?: unknown;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const b64 = String(input.b64 ?? '').trim();
  if (b64) return Buffer.from(b64, 'base64');

  const url = String(input.url ?? '').trim();
  if (!url) throw new Error('IMAGE_GENERATION_EMPTY_RESULT');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('IMAGE_PROVIDER_URL_INVALID');
  const response = await fetch(parsed, { signal: input.signal });
  if (!response.ok) throw new Error(`IMAGE_PROVIDER_DOWNLOAD_FAILED:${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export function normalizedCount(value: number): number {
  return Math.max(1, Math.min(4, Math.floor(Number(value) || 1)));
}

export function normalizedOutputSize(
  value: ImageOutputSize | string | null | undefined,
): ImageOutputSize {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === '1K' || normalized === '2K' || normalized === '4K') {
    return normalized;
  }
  return 'auto';
}

export function requestedOutputSize(
  request: Pick<ImageGenerationRequest, 'outputSize' | 'quality' | 'config'>,
  options: {
    supported?: readonly string[];
    fallbackStandard?: ImageOutputSize;
    fallbackHigh?: ImageOutputSize;
    capAt?: Exclude<ImageOutputSize, 'auto'>;
  } = {},
): ImageOutputSize {
  const explicit = normalizedOutputSize(request.outputSize);
  const catalogSupported = options.supported
    ?? request.config.capabilities.imageOutputSizes
    ?? [];

  let resolved: ImageOutputSize;
  if (explicit !== 'auto') {
    resolved = explicit;
  } else {
    const configured = request.quality === 'high'
      ? request.config.capabilities.highImageOutputSize
      : request.config.capabilities.defaultImageOutputSize;
    resolved = normalizedOutputSize(
      configured
      ?? (request.quality === 'high'
        ? options.fallbackHigh
        : options.fallbackStandard),
    );
  }

  if (resolved === 'auto') return 'auto';

  if (catalogSupported.length > 0) {
    const normalizedSupported = new Set(
      catalogSupported.map((value) => String(value).trim().toUpperCase()),
    );
    if (!normalizedSupported.has(resolved)) {
      resolved = highestSupportedAtOrBelow(normalizedSupported, resolved) ?? 'auto';
    }
  }

  if (options.capAt && resolved !== 'auto') {
    return outputSizeRank(resolved) > outputSizeRank(options.capAt)
      ? options.capAt
      : resolved;
  }

  return resolved;
}

export function targetSideForOutputSize(
  value: ImageOutputSize,
  fallback: number,
): number {
  if (value === '1K') return 1024;
  if (value === '2K') return 2048;
  if (value === '4K') return 4096;
  return fallback;
}

export function aspectRatioValue(value: string | null | undefined): number {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'auto' || normalized === 'square') return 1;
  if (normalized === 'portrait') return 2 / 3;
  if (normalized === 'landscape') return 3 / 2;
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return 1;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 1;
}


export function closestSupportedAspectRatio(
  value: string | null | undefined,
  supportedValues: readonly string[],
): string | null {
  let normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'square') normalized = '1:1';
  if (normalized === 'portrait') normalized = '2:3';
  if (normalized === 'landscape') normalized = '3:2';

  const supported = supportedValues.map((item) => String(item).trim().toLowerCase());
  if (supported.includes(normalized)) return normalized;
  if (normalized === 'auto') {
    return supported.includes('auto') ? 'auto' : null;
  }

  const target = aspectRatioValue(normalized);
  if (!Number.isFinite(target) || target <= 0) return null;

  let best: { value: string; distance: number } | null = null;
  for (const candidate of supported) {
    if (candidate === 'auto') continue;
    const ratio = aspectRatioValue(candidate);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const distance = Math.abs(Math.log(ratio / target));
    if (!best || distance < best.distance) {
      best = { value: candidate, distance };
    }
  }
  return best?.value ?? null;
}

export function rasterSizeForAspectRatio(input: {
  aspectRatio: string | null | undefined;
  targetArea: number;
  maxSide: number;
  separator: 'x' | '*';
  multiple?: number;
  minSide?: number;
}): string {
  const ratio = aspectRatioValue(input.aspectRatio);
  let width = Math.sqrt(input.targetArea * ratio);
  let height = Math.sqrt(input.targetArea / ratio);
  const scale = Math.min(1, input.maxSide / Math.max(width, height));
  width *= scale;
  height *= scale;
  const multiple = Math.max(1, Math.floor(input.multiple ?? 8));
  const minSide = Math.max(multiple, Math.floor(input.minSide ?? 256));
  const roundedWidth = Math.max(minSide, Math.round(width / multiple) * multiple);
  const roundedHeight = Math.max(minSide, Math.round(height / multiple) * multiple);
  return `${roundedWidth}${input.separator}${roundedHeight}`;
}

export function openAiImageSize(request: ImageGenerationRequest): string {
  const explicit = normalizedOutputSize(request.outputSize);
  const ratio = aspectRatioValue(request.aspectRatio);

  if (explicit === 'auto') {
    if (!explicitAspectRatio(request.aspectRatio)) return '1024x1024';
    if (ratio > 1.05) return '1536x1024';
    if (ratio < 0.95) return '1024x1536';
    return '1024x1024';
  }

  const targetArea = explicit === '4K'
    ? 3840 * 2160
    : targetSideForOutputSize(explicit, 1024) ** 2;

  return rasterSizeForAspectRatio({
    aspectRatio: request.aspectRatio,
    targetArea,
    maxSide: explicit === '4K'
      ? 3840
      : targetSideForOutputSize(explicit, 2048),
    separator: 'x',
    multiple: 16,
    minSide: 512,
  });
}

function explicitAspectRatio(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return Boolean(normalized && normalized !== 'auto');
}

function outputSizeRank(value: Exclude<ImageOutputSize, 'auto'>): number {
  if (value === '4K') return 4;
  if (value === '2K') return 2;
  return 1;
}

function highestSupportedAtOrBelow(
  supported: Set<string>,
  requested: Exclude<ImageOutputSize, 'auto'>,
): Exclude<ImageOutputSize, 'auto'> | null {
  const ordered: Array<Exclude<ImageOutputSize, 'auto'>> = ['4K', '2K', '1K'];
  const maxRank = outputSizeRank(requested);
  return ordered.find(
    (candidate) => outputSizeRank(candidate) <= maxRank && supported.has(candidate),
  ) ?? null;
}
