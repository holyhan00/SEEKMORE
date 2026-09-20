export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function stringArray(value: unknown, maxItems = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => nonEmptyString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

export function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = finiteNumber(value);
  if (number == null) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function safeFilename(value: unknown, fallback: string, extension: string): string {
  const base = nonEmptyString(value) ?? fallback;
  const clean = base.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  const normalized = clean || fallback;
  return normalized.toLowerCase().endsWith(`.${extension}`)
    ? normalized
    : `${normalized}.${extension}`;
}

export function serializeForPrompt(value: unknown, maxChars = 120_000): string {
  let output: string;
  try {
    output = JSON.stringify(value ?? null, null, 2);
  } catch {
    output = String(value ?? '');
  }
  if (output.length <= maxChars) return output;
  return `${output.slice(0, maxChars)}\n...[truncated ${output.length - maxChars} chars]`;
}

export function cleanHex(value: unknown, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(/^#/, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (normalized.length === 6) return normalized;
  if (normalized.length === 8) return normalized.slice(2);
  return fallback.replace(/^#/, '').toUpperCase();
}

export function isRenderPlaceholderText(
  value: unknown,
): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;

  return /^\[\s*block[-_][a-z0-9_-]+\s+(?:内容|content)\s*\]$/i.test(text);
}

export function firstRenderSourcePlaceholder(
  blocks: unknown[] | undefined,
): { path: string; value: string } | null {
  if (!Array.isArray(blocks)) return null;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!isRecord(block)) continue;

    for (const field of ['text', 'content'] as const) {
      const value = block[field];
      if (isRenderPlaceholderText(value)) {
        return {
          path: `$.source.blocks[${index}].${field}`,
          value: String(value),
        };
      }
    }

    if (Array.isArray(block.items)) {
      for (
        let itemIndex = 0;
        itemIndex < block.items.length;
        itemIndex += 1
      ) {
        const value = block.items[itemIndex];
        if (isRenderPlaceholderText(value)) {
          return {
            path: `$.source.blocks[${index}].items[${itemIndex}]`,
            value: String(value),
          };
        }
      }
    }
  }

  return null;
}
