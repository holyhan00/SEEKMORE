import {
  normalizeLanguageTagOr,
  normalizeUiLocale,
} from './locale-normalizer';
import {
  DEFAULT_FORMAT_LOCALE,
  DEFAULT_TIME_ZONE,
  DEFAULT_UI_LOCALE,
  type ResolvedClientLocaleSnapshot,
  type UiLocale,
} from './locale.types';

export function getSystemLocale(): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
  const preferred = Array.isArray(navigator.languages)
    ? navigator.languages.find(Boolean)
    : navigator.language;

  return normalizeLanguageTagOr(
    preferred || resolved,
    resolved || DEFAULT_FORMAT_LOCALE,
  );
}

export function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
    || DEFAULT_TIME_ZONE;
}

export function detectSystemUiLocale(): UiLocale {
  const candidates = [
    ...(Array.isArray(navigator.languages)
      ? navigator.languages
      : []),
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ];

  for (const candidate of candidates) {
    const locale = normalizeUiLocale(candidate);
    if (locale) return locale;
  }

  return DEFAULT_UI_LOCALE;
}

export function createClientLocaleSnapshot(
  language: UiLocale,
): ResolvedClientLocaleSnapshot {
  return {
    language,
    formatLocale: getSystemLocale(),
    timeZone: getSystemTimeZone(),
  };
}
