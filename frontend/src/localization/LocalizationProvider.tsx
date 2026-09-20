import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  I18nextProvider,
} from 'react-i18next';
import {
  createClientLocaleSnapshot,
  detectSystemUiLocale,
} from './locale-device';
import {
  normalizeUiLocale,
} from './locale-normalizer';
import {
  localization,
  setLocalizationLanguage,
} from './localization';
import type {
  ResolvedClientLocaleSnapshot,
  UiLanguagePreference,
  UiLocale,
  UserLocalizationPreferences,
} from './locale.types';

const LANGUAGE_STORAGE_KEY = 'seekmore.localization.uiLanguage';

interface LocalizationContextValue {
  uiLocale: UiLocale;
  preference: UiLanguagePreference;
  snapshot: ResolvedClientLocaleSnapshot;
  setPreference(value: UiLanguagePreference): Promise<void>;
  applyAccountPreferences(input: UserLocalizationPreferences): Promise<void>;
}

const LocalizationContext =
  createContext<LocalizationContextValue | null>(null);

let currentUiLocale: UiLocale = detectSystemUiLocale();

export function getLocalizationSnapshot(): ResolvedClientLocaleSnapshot {
  return createClientLocaleSnapshot(currentUiLocale);
}

export function LocalizationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const initialLanguagePreference = readLanguagePreference();
  const [preference, setPreferenceState] =
    useState<UiLanguagePreference>(initialLanguagePreference);
  const [uiLocale, setUiLocale] = useState<UiLocale>(() => {
    const initialUiLocale =
      resolveLanguagePreference(initialLanguagePreference);
    currentUiLocale = initialUiLocale;
    return initialUiLocale;
  });

  const applyLanguagePreference = useCallback(async (
    nextPreference: UiLanguagePreference,
    persist: boolean,
  ) => {
    const nextLocale = resolveLanguagePreference(nextPreference);
    currentUiLocale = nextLocale;
    setPreferenceState(nextPreference);
    setUiLocale(nextLocale);
    await setLocalizationLanguage(nextLocale);

    if (persist) {
      writeStorage(LANGUAGE_STORAGE_KEY, nextPreference);
    }
  }, []);

  useEffect(() => {
    void applyLanguagePreference(preference, false);
  }, [applyLanguagePreference, preference]);

  useEffect(() => {
    const handleLanguageChange = () => {
      if (preference === 'system') {
        void applyLanguagePreference('system', false);
      }
    };

    window.addEventListener('languagechange', handleLanguageChange);
    return () => {
      window.removeEventListener('languagechange', handleLanguageChange);
    };
  }, [applyLanguagePreference, preference]);

  const setPreference = useCallback(async (
    value: UiLanguagePreference,
  ) => {
    await applyLanguagePreference(value, true);
  }, [applyLanguagePreference]);

  const applyAccountPreferences = useCallback(async (
    input: UserLocalizationPreferences,
  ) => {
    await applyLanguagePreference(
      input.preferredLanguage ?? 'system',
      true,
    );
  }, [applyLanguagePreference]);

  const snapshot = useMemo(
    () => createClientLocaleSnapshot(uiLocale),
    [uiLocale],
  );

  const value = useMemo<LocalizationContextValue>(() => ({
    uiLocale,
    preference,
    snapshot,
    setPreference,
    applyAccountPreferences,
  }), [
    applyAccountPreferences,
    preference,
    setPreference,
    snapshot,
    uiLocale,
  ]);

  return (
    <LocalizationContext.Provider value={value}>
      <I18nextProvider i18n={localization}>
        {children}
      </I18nextProvider>
    </LocalizationContext.Provider>
  );
}

export function useLocalization(): LocalizationContextValue {
  const context = useContext(LocalizationContext);
  if (!context) {
    throw new Error(
      'useLocalization must be used inside LocalizationProvider',
    );
  }
  return context;
}

function readLanguagePreference(): UiLanguagePreference {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'system') return 'system';

    const locale = normalizeUiLocale(stored);
    if (locale) return locale;
  } catch {
                                                             
  }

  return 'system';
}

function resolveLanguagePreference(
  preference: UiLanguagePreference,
): UiLocale {
  return preference === 'system'
    ? detectSystemUiLocale()
    : preference;
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
                                                             
  }
}
