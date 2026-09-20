import { ModelProviderError } from '../../errors/agent-runtime.errors';
import { withTimeout } from '../../util/runtime.util';
import { releaseModelResponse } from '../model-http.util';

export interface SseFrame {
  event: string | null;
  data: string;
  id: string | null;
}

export async function* decodeSse(
  response: Response,
  input: {
    signal?: AbortSignal;
    firstTokenTimeoutMs: number;
    idleTimeoutMs: number;
    onFirstFrame?: () => void;
  },
): AsyncGenerator<SseFrame> {
  if (!response.body) {
    throw new ModelProviderError('MODEL_STREAM_MISSING', 'Model provider returned no response body', true);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let first = true;

  try {
    while (true) {
      const timeout = first ? input.firstTokenTimeoutMs : input.idleTimeoutMs;
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await withTimeout(reader.read(), timeout, first ? 'MODEL_FIRST_TOKEN_TIMEOUT' : 'MODEL_IDLE_TIMEOUT', input.signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.includes('FIRST_TOKEN')
          ? 'MODEL_FIRST_TOKEN_TIMEOUT'
          : message.includes('IDLE')
            ? 'MODEL_IDLE_TIMEOUT'
            : input.signal?.aborted
              ? 'MODEL_CANCELLED'
              : 'MODEL_STREAM_READ_FAILED';
        throw new ModelProviderError(code, message, code !== 'MODEL_CANCELLED', error);
      }
      if (chunk.done) break;
      if (first) {
        first = false;
        input.onFirstFrame?.();
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      while (true) {
        const boundary = nextBoundary(buffer);
        if (boundary < 0) break;
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(skipBoundary(buffer, boundary));
        const frame = parseFrame(raw);
        if (frame) yield frame;
      }
    }
    buffer += decoder.decode();
    const frame = parseFrame(buffer);
    if (frame) yield frame;
  } finally {
    try { await reader.cancel(); } catch {                             }
    reader.releaseLock();
    releaseModelResponse(response);
  }
}

function nextBoundary(value: string): number {
  const crlf = value.indexOf('\r\n\r\n');
  const lf = value.indexOf('\n\n');
  if (crlf < 0) return lf;
  if (lf < 0) return crlf;
  return Math.min(crlf, lf);
}

function skipBoundary(value: string, index: number): number {
  return value.startsWith('\r\n\r\n', index) ? index + 4 : index + 2;
}

function parseFrame(raw: string): SseFrame | null {
  if (!raw.trim()) return null;
  let event: string | null = null;
  let id: string | null = null;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  return { event, id, data: data.join('\n') };
}
