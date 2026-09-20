import { BadRequestException } from '@nestjs/common';

const DEFAULT_VIDEO_MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

export function videoMaxOutputBytes(): number {
  const objectLimit = positiveInt(process.env.OBJECT_CATALOG_MAX_UPLOAD_BYTES)
    ?? DEFAULT_VIDEO_MAX_OUTPUT_BYTES;
  const videoLimit = positiveInt(process.env.VIDEO_GENERATION_MAX_OUTPUT_BYTES)
    ?? DEFAULT_VIDEO_MAX_OUTPUT_BYTES;
  return Math.min(objectLimit, videoLimit);
}

export async function responseRecord(response: Response, errorPrefix: string): Promise<Record<string, any>> {
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const message = String(
      body?.error?.message
      ?? body?.base_resp?.status_msg
      ?? body?.message
      ?? response.statusText
      ?? 'provider error',
    ).trim();
    throw new Error(`${errorPrefix}:${response.status}:${message}`);
  }
  return body;
}

export async function downloadVideo(input: {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const rawUrl = String(input.url ?? '').trim();
  if (!rawUrl) throw new Error('VIDEO_PROVIDER_DOWNLOAD_URL_REQUIRED');
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('VIDEO_PROVIDER_DOWNLOAD_URL_INVALID');

  const response = await fetch(url, {
    headers: input.headers,
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(`VIDEO_PROVIDER_DOWNLOAD_FAILED:${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  const maximum = videoMaxOutputBytes();
  if (Number.isFinite(contentLength) && contentLength > maximum) {
    throw new BadRequestException('VIDEO_GENERATION_OUTPUT_TOO_LARGE');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('VIDEO_GENERATION_EMPTY_RESULT');
  if (buffer.length > maximum) throw new BadRequestException('VIDEO_GENERATION_OUTPUT_TOO_LARGE');
  assertMp4(buffer);
  return buffer;
}

export function assertMp4(buffer: Buffer): void {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw new Error('VIDEO_GENERATION_INVALID_MP4');
  }
  const box = buffer.subarray(4, 8).toString('ascii');
  if (box !== 'ftyp') throw new Error('VIDEO_GENERATION_INVALID_MP4');
}

export function mp4DurationSeconds(buffer: Buffer): number | null {
  const mvhd = findMp4Box(buffer, 0, buffer.length, 'mvhd');
  if (!mvhd || mvhd.payloadStart + 20 > mvhd.end) return null;

  const version = buffer.readUInt8(mvhd.payloadStart);
  if (version === 0) {
    const timescaleOffset = mvhd.payloadStart + 12;
    const durationOffset = mvhd.payloadStart + 16;
    if (durationOffset + 4 > mvhd.end) return null;
    const timescale = buffer.readUInt32BE(timescaleOffset);
    const duration = buffer.readUInt32BE(durationOffset);
    return timescale > 0 ? duration / timescale : null;
  }
  if (version === 1) {
    const timescaleOffset = mvhd.payloadStart + 20;
    const durationOffset = mvhd.payloadStart + 24;
    if (durationOffset + 8 > mvhd.end) return null;
    const timescale = buffer.readUInt32BE(timescaleOffset);
    const duration = Number(buffer.readBigUInt64BE(durationOffset));
    return timescale > 0 && Number.isSafeInteger(duration)
      ? duration / timescale
      : null;
  }
  return null;
}

type Mp4Box = { payloadStart: number; end: number };

function findMp4Box(
  buffer: Buffer,
  start: number,
  end: number,
  target: string,
): Mp4Box | null {
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) return null;
      const wide = Number(buffer.readBigUInt64BE(offset + 8));
      if (!Number.isSafeInteger(wide)) return null;
      size = wide;
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) return null;
    const payloadStart = offset + headerSize;
    const boxEnd = offset + size;
    if (type === target) return { payloadStart, end: boxEnd };
    if (type === 'moov') {
      const nested = findMp4Box(buffer, payloadStart, boxEnd, target);
      if (nested) return nested;
    }
    offset = boxEnd;
  }
  return null;
}

export function normalizeAspectRatio(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function normalizeResolution(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function normalizeModel(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function providerPollIntervalMs(): number {
  return boundedPositiveInt(
    process.env.VIDEO_GENERATION_POLL_INTERVAL_MS,
    5_000,
    1_000,
    30_000,
  );
}

export function providerMaxPolls(): number {
  return boundedPositiveInt(
    process.env.VIDEO_GENERATION_MAX_POLLS,
    180,
    1,
    720,
  );
}

export function base64DataUrl(input: {
  mimeType: string;
  buffer: Buffer;
}): string {
  return `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
}

export function base64InlineData(input: {
  mimeType: string;
  buffer: Buffer;
}): { inlineData: { mimeType: string; data: string } } {
  return {
    inlineData: {
      mimeType: input.mimeType,
      data: input.buffer.toString('base64'),
    },
  };
}

export function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedPositiveInt(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = positiveInt(value) ?? fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function abortError(): Error {
  const error = new Error('VIDEO_GENERATION_ABORTED');
  error.name = 'AbortError';
  return error;
}
