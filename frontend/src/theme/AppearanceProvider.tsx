import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  applyResolvedTheme,
  getSystemTheme,
  readAppearancePreference,
  resolveAppearancePreference,
  subscribeSystemTheme,
  writeAppearancePreference,
} from './appearance.storage';
import type {
  AppearancePreference,
  ResolvedTheme,
} from './appearance.types';

export interface AppearanceContextValue {
  preference: AppearancePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (
    preference: AppearancePreference,
  ) => void;
}

export const AppearanceContext =
  createContext<AppearanceContextValue | null>(
    null,
  );

export function AppearanceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [preference, setPreferenceState] =
    useState<AppearancePreference>(() =>
      readAppearancePreference(),
    );

  const [systemTheme, setSystemTheme] =
    useState<ResolvedTheme>(() =>
      getSystemTheme(),
    );

  const resolvedTheme =
    resolveAppearancePreference(
      preference,
      systemTheme,
    );

  useEffect(() => {
    if (preference !== 'system') {
      return undefined;
    }

    setSystemTheme(getSystemTheme());

    return subscribeSystemTheme(
      setSystemTheme,
    );
  }, [preference]);

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setPreference = useCallback(
    (
      nextPreference:
        AppearancePreference,
    ) => {
      const currentSystemTheme =
        getSystemTheme();

      writeAppearancePreference(
        nextPreference,
      );

      if (nextPreference === 'system') {
        setSystemTheme(
          currentSystemTheme,
        );
      }

      setPreferenceState(
        nextPreference,
      );

      applyResolvedTheme(
        resolveAppearancePreference(
          nextPreference,
          currentSystemTheme,
        ),
      );
    },
    [],
  );

  const value = useMemo(
    () => ({
      preference,
      resolvedTheme,
      setPreference,
    }),
    [
      preference,
      resolvedTheme,
      setPreference,
    ],
  );

  return (
    <AppearanceContext.Provider
      value={value}
    >
      {children}
    </AppearanceContext.Provider>
  );
}
