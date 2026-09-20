import { useCallback } from 'react';
import { useLocalize } from './useLocalize';

export function useSystemResourcePresentation() {
  const localize = useLocalize();

  const mcpText = useCallback((input: {
    source?: string | null;
    stableKey?: string | null;
    field: 'productIntroduction' | 'description';
    fallback?: string | null;
  }): string => {
    const fallback = String(input.fallback ?? '');
    const stableKey = String(input.stableKey ?? '').trim();
    if (String(input.source ?? '').toUpperCase() !== 'SYSTEM' || !stableKey) {
      return fallback;
    }
    return localize(`mcp.${stableKey}.${input.field}`, { defaultValue: fallback });
  }, [localize]);

  const systemAgentDescription = useCallback((input: {
    key?: string | null;
    isSuper?: boolean | null;
    fallback?: string | null;
  }): string => {
    const fallback = String(input.fallback ?? '');
    const key = String(input.key ?? '').trim();
    if (!input.isSuper || !key) return fallback;
    return localize(`agents.system.${key}.description`, { defaultValue: fallback });
  }, [localize]);

  return {
    mcpText,
    systemAgentDescription,
  };
}
