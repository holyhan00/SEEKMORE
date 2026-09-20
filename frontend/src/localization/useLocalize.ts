import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export function useLocalize() {
  const { t } = useTranslation();
  return useCallback(
    (key: string, values?: Record<string, unknown>) => String(t(key, values)),
    [t],
  );
}
