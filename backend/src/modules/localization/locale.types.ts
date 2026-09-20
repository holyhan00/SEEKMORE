export const DEFAULT_FORMAT_LOCALE = 'en-US' as const;
export const DEFAULT_TIME_ZONE = 'UTC' as const;

export interface ClientLocaleSnapshot {
  language: string | null;
  formatLocale: string | null;
  timeZone: string | null;
}

export interface ResolvedLocaleContext {
  language: string | null;
  formatLocale: string;
  timeZone: string;
}

export const DEFAULT_LOCALE_CONTEXT: ResolvedLocaleContext = {
  language: null,
  formatLocale: DEFAULT_FORMAT_LOCALE,
  timeZone: DEFAULT_TIME_ZONE,
};
