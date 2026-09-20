import type { Prisma } from '@prisma/client';

const MAX_JSON_DEPTH = 64;

export function sanitizeRuntimeTimelineJson(
  value: unknown,
): Prisma.InputJsonValue {
  const sanitized = sanitizeValue(value, new WeakSet<object>(), 0);
  return (sanitized ?? null) as Prisma.InputJsonValue;
}

function sanitizeValue(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): unknown {
  if (value == null) return null;

  if (typeof value === 'string') {
    return sanitizeUnicode(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (
    typeof value === 'undefined'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return undefined;
  }

  if (depth >= MAX_JSON_DEPTH) {
    return '[Max JSON depth exceeded]';
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: sanitizeUnicode(value.name),
      message: sanitizeUnicode(value.message),
      stack: value.stack ? sanitizeUnicode(value.stack) : null,
    };
  }

  if (Buffer.isBuffer(value)) {
    return `[Binary data: ${value.length} bytes]`;
  }

  if (ArrayBuffer.isView(value)) {
    return `[Binary data: ${value.byteLength} bytes]`;
  }

  if (value instanceof ArrayBuffer) {
    return `[Binary data: ${value.byteLength} bytes]`;
  }

  if (typeof value !== 'object') {
    return sanitizeUnicode(String(value));
  }

  if (ancestors.has(value)) {
    return '[Circular]';
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const sanitized = sanitizeValue(item, ancestors, depth + 1);
        return sanitized === undefined ? null : sanitized;
      });
    }

    if (value instanceof Map) {
      const result: Record<string, unknown> = {};
      for (const [key, item] of value.entries()) {
        const sanitized = sanitizeValue(item, ancestors, depth + 1);
        if (sanitized === undefined) continue;
        result[sanitizeUnicode(String(key))] = sanitized;
      }
      return result;
    }

    if (value instanceof Set) {
      return [...value].map((item) => {
        const sanitized = sanitizeValue(item, ancestors, depth + 1);
        return sanitized === undefined ? null : sanitized;
      });
    }

    const result: Record<string, unknown> = {};
    for (const [rawKey, item] of Object.entries(value)) {
      const sanitized = sanitizeValue(item, ancestors, depth + 1);
      if (sanitized === undefined) continue;
      const key = sanitizeUnicode(rawKey);
      if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') {
        continue;
      }
      result[key] = sanitized;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function sanitizeUnicode(value: string): string {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code === 0) {
      continue;
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += '\ufffd';
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\ufffd';
      continue;
    }

    result += value[index];
  }

  return result;
}
