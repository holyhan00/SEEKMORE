import { en } from './resources/en';
import { zhHans } from './resources/zh-Hans';
import { zhHant } from './resources/zh-Hant';

export function assertLocalizationCatalogConsistency(): void {
  const catalogs = {
    en,
    'zh-Hans': zhHans,
    'zh-Hant': zhHant,
  } as const;

  const baseKeys = Object.keys(en).sort();
  const base = new Set(baseKeys);

  for (const [locale, catalog] of Object.entries(catalogs)) {
    const keys = Object.keys(catalog);
    const keySet = new Set(keys);
    const missing = baseKeys.filter((key) => !keySet.has(key));
    const extra = keys.filter((key) => !base.has(key));

    if (missing.length || extra.length) {
      throw new Error(
        `[Localization] catalog mismatch for ${locale}; missing=${missing.join(',') || '-'}; extra=${extra.join(',') || '-'}`,
      );
    }
  }
}
