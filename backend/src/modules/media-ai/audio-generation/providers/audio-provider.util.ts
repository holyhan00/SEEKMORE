import { BadRequestException } from '@nestjs/common';

const MAX_AUDIO_OUTPUT_BYTES = 100 * 1024 * 1024;

export async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) throw providerError(response.status, body);
  return record(body);
}

export async function responseBuffer(response: Response): Promise<Buffer> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw providerError(response.status, { message: text });
  }
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_AUDIO_OUTPUT_BYTES) {
    throw new BadRequestException('AUDIO_PROVIDER_OUTPUT_TOO_LARGE');
  }
  const output = Buffer.from(await response.arrayBuffer());
  if (output.byteLength <= 0) throw new BadRequestException('AUDIO_PROVIDER_EMPTY_OUTPUT');
  if (output.byteLength > MAX_AUDIO_OUTPUT_BYTES) {
    throw new BadRequestException('AUDIO_PROVIDER_OUTPUT_TOO_LARGE');
  }
  return output;
}

export function assertMiniMaxSuccess(body: Record<string, unknown>): void {
  const base = record(body.base_resp);
  const statusCode = Number(base.status_code ?? 0);
  if (statusCode !== 0) throw providerError(statusCode, body);
}

export function decodeHexAudio(body: Record<string, unknown>): Buffer {
  assertMiniMaxSuccess(body);
  const audio = String(record(body.data).audio ?? '').trim();
  if (!audio || !/^[0-9a-f]+$/i.test(audio) || audio.length % 2 !== 0) {
    throw new BadRequestException('AUDIO_PROVIDER_EMPTY_OUTPUT');
  }
  const output = Buffer.from(audio, 'hex');
  if (output.byteLength > MAX_AUDIO_OUTPUT_BYTES) {
    throw new BadRequestException('AUDIO_PROVIDER_OUTPUT_TOO_LARGE');
  }
  return output;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function safeFileName(value: string, fallback: string): string {
  const output = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 120);
  return output || fallback;
}

function providerError(status: number, body: unknown): BadRequestException {
  const source = record(body);
  const detail = record(source.detail);
  const error = record(source.error);
  const base = record(source.base_resp);
  const message = String(
    detail.message
      ?? error.message
      ?? source.message
      ?? source.detail
      ?? source.error
      ?? base.status_msg
      ?? '',
  ).replace(/\s+/g, ' ').trim().slice(0, 500);
  return new BadRequestException(
    message && message !== '[object Object]'
      ? `AUDIO_PROVIDER_REQUEST_FAILED:${status}:${message}`
      : `AUDIO_PROVIDER_REQUEST_FAILED:${status}`,
  );
}
