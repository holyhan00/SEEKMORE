import { createHash, randomUUID } from 'node:crypto';

export function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: any): any => {
    if (!input || typeof input !== 'object') return input;
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
  };
  try {
    return JSON.stringify(normalize(value));
  } catch {
    return String(value);
  }
}

export function hash(value: unknown, length = 24): string {
  return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex').slice(0, length);
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const head = Math.max(0, Math.floor(maximum * 0.72));
  const tail = Math.max(0, maximum - head - 40);
  return `${value.slice(0, head)}\n...[truncated ${value.length - maximum} chars]...\n${value.slice(-tail)}`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('ABORTED'));
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('ABORTED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function composeSignals(signals: Array<AbortSignal | undefined>, timeoutMs?: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    listeners.push(() => signal.removeEventListener('abort', onAbort));
  }
  const timer: ReturnType<typeof setTimeout> | null = timeoutMs && timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs)
    : null;
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      for (const remove of listeners) remove();
    },
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(code))), timeoutMs);
    const onAbort = () => finish(() => reject(signal?.reason ?? new Error('ABORTED')));
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const source = String(raw ?? '').trim();
  if (!source) return {};
  const candidates = [
    source,
    source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {                }
  }
  return {};
}
