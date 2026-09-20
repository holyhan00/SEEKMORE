import {
  DEFAULT_FORMAT_LOCALE,
  type ClientLocaleSnapshot,
} from './locale.types';

export function normalizeLanguageTag(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  try {
    return new Intl.Locale(text.replace(/_/g, '-')).toString();
  } catch {
    return null;
  }
}

export function normalizeTimeZone(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  try {
    new Intl.DateTimeFormat(DEFAULT_FORMAT_LOCALE, {
      timeZone: text,
    }).format(new Date(0));
    return text;
  } catch {
    return null;
  }
}

export function normalizeClientLocaleSnapshot(
  value: unknown,
): ClientLocaleSnapshot {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    language: normalizeLanguageTag(row.language),
    formatLocale: normalizeLanguageTag(row.formatLocale),
    timeZone: normalizeTimeZone(row.timeZone),
  };
}
