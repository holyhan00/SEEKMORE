import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './resources/en';
import { zhHans } from './resources/zh-Hans';
import { zhHant } from './resources/zh-Hant';
import {
  DEFAULT_UI_LOCALE,
  UI_LOCALES,
  type UiLocale,
} from './locale.types';
import { assertLocalizationCatalogConsistency } from './catalog-consistency';

export const localization = i18n.createInstance();

if (import.meta.env.DEV) {
  assertLocalizationCatalogConsistency();
}

void localization
  .use(initReactI18next)
  .init({
    lng: DEFAULT_UI_LOCALE,
    fallbackLng: {
      'zh-Hant': ['zh-Hans', 'en'],
      'zh-Hans': ['en'],
      en: ['en'],
      default: ['en'],
    },
    supportedLngs: [...UI_LOCALES],
    resources: {
      en: { translation: en },
      'zh-Hans': { translation: zhHans },
      'zh-Hant': { translation: zhHant },
    },
    keySeparator: false,
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
  });

export async function setLocalizationLanguage(locale: UiLocale): Promise<void> {
  if (localization.language !== locale) {
    await localization.changeLanguage(locale);
  }

  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = localization.dir(locale);
  }
}

export function localizeText(
  key: string,
  values?: Record<string, unknown>,
): string {
  return String(localization.t(key, values));
}
