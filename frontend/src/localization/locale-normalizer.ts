import {
  DEFAULT_FORMAT_LOCALE,
  type UiLocale,
} from './locale.types';

const UI_LOCALE_ALIASES: Readonly<Record<string, UiLocale>> = {
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-hans-cn': 'zh-Hans',
  'zh-hans-sg': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  'zh-hant-tw': 'zh-Hant',
  'zh-hant-hk': 'zh-Hant',
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  'en-au': 'en',
  'en-ca': 'en',
};

export function normalizeUiLocale(value: unknown): UiLocale | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const normalized = text.replace(/_/g, '-').toLowerCase();
  const exact = UI_LOCALE_ALIASES[normalized];
  if (exact) return exact;

  if (normalized.startsWith('zh-hant')) return 'zh-Hant';
  if (normalized.startsWith('zh')) return 'zh-Hans';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

export function normalizeLanguageTag(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  try {
    return new Intl.Locale(text.replace(/_/g, '-')).toString();
  } catch {
    return null;
  }
}

export function normalizeLanguageTagOr(
  value: unknown,
  fallback: string,
): string {
  return normalizeLanguageTag(value)
    ?? normalizeLanguageTag(fallback)
    ?? DEFAULT_FORMAT_LOCALE;
}
