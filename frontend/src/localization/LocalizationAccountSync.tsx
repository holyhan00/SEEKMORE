import { useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from '../hooks/auth/useAuth';
import { getUserLocalizationPreferences } from './localization.api';
import { useLocalization } from './LocalizationProvider';

export function LocalizationAccountSync({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  const { applyAccountPreferences } = useLocalization();
  const syncedToken = useRef(false);

  useEffect(() => {
    if (!isLoggedIn) {
      syncedToken.current = false;
      return;
    }
    if (syncedToken.current) return;

    let cancelled = false;
    syncedToken.current = true;

    void getUserLocalizationPreferences()
      .then((preferences) => {
        if (!cancelled) {
          void applyAccountPreferences(preferences);
        }
      })
      .catch(() => {
        syncedToken.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [applyAccountPreferences, isLoggedIn]);

  return children;
}
