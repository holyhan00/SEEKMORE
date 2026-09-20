import { localizeText } from '../../../../localization/localization';
import { useCallback, useEffect, useState } from 'react';
import { listSkills } from '../api/skill.api';
import type { SkillSummary } from '../types/skill.types';

export function useSkillList(params: Record<string, string | number | boolean | undefined>, autoLoad = true) {
  const [items, setItems] = useState<SkillSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const key = JSON.stringify(params);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await listSkills(params); setItems(result.items); setTotal(result.total); }
    catch (reason) { setError(reason instanceof Error ? reason.message : localizeText('skills.loadFailed')); }
    finally { setLoading(false); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoLoad) void refresh(); }, [autoLoad, refresh]);
  return { items, total, loading, error, refresh };
}
