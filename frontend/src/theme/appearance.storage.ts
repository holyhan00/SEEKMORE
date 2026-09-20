import type {
  AppearancePreference,
  ResolvedTheme,
} from './appearance.types';

export const APPEARANCE_STORAGE_KEY =
  'seekmore.appearance';

export function readAppearancePreference(): AppearancePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const stored = window.localStorage.getItem(
    APPEARANCE_STORAGE_KEY,
  );

  if (
    stored === 'light' ||
    stored === 'dark' ||
    stored === 'system'
  ) {
    return stored;
  }

  return 'system';
}

export function writeAppearancePreference(
  preference: AppearancePreference,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    APPEARANCE_STORAGE_KEY,
    preference,
  );
}

export function getSystemTheme(): ResolvedTheme {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches
  ) {
    return 'dark';
  }

  return 'light';
}

export function resolveAppearancePreference(
  preference: AppearancePreference,
  systemTheme: ResolvedTheme = getSystemTheme(),
): ResolvedTheme {
  return preference === 'system'
    ? systemTheme
    : preference;
}

export function applyResolvedTheme(
  resolvedTheme: ResolvedTheme,
): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  root.classList.toggle(
    'dark',
    resolvedTheme === 'dark',
  );
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
}

export function initializeAppearance(): {
  preference: AppearancePreference;
  resolvedTheme: ResolvedTheme;
} {
  const preference =
    readAppearancePreference();
  const resolvedTheme =
    resolveAppearancePreference(
      preference,
    );

  applyResolvedTheme(resolvedTheme);

  return {
    preference,
    resolvedTheme,
  };
}

export function subscribeSystemTheme(
  listener: (theme: ResolvedTheme) => void,
): () => void {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(
    '(prefers-color-scheme: dark)',
  );

  const handleChange = (
    event: MediaQueryListEvent,
  ) => {
    listener(
      event.matches
        ? 'dark'
        : 'light',
    );
  };

  mediaQuery.addEventListener(
    'change',
    handleChange,
  );

  return () => {
    mediaQuery.removeEventListener(
      'change',
      handleChange,
    );
  };
}
