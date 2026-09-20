export const UI_LOCALES = ['zh-Hans', 'zh-Hant', 'en'] as const;

export const DEFAULT_UI_LOCALE = 'en' as const;
export const DEFAULT_FORMAT_LOCALE = 'en-US' as const;
export const DEFAULT_TIME_ZONE = 'UTC' as const;

export type UiLocale = (typeof UI_LOCALES)[number];
export type UiLanguagePreference = UiLocale | 'system';

export interface ClientLocaleSnapshot {
  language: UiLocale | null;
  formatLocale: string | null;
  timeZone: string | null;
}

export interface ResolvedClientLocaleSnapshot extends ClientLocaleSnapshot {
  language: UiLocale;
  formatLocale: string;
  timeZone: string;
}

export interface UserLocalizationPreferences {
  preferredLanguage: UiLocale | null;
}
