import { localizeText } from '../../../../localization/localization';
import { useCallback, useEffect, useState } from 'react';
import {
  listDeletedCognitiveAgents,
  listMyCognitiveAgents,
} from '../api/cognitive-agent.api';
import type {
  CognitiveAgent,
  CognitiveAgentLibraryView,
} from '../api/cognitive-agent.types';

export function useCognitiveAgents(
  autoLoad = true,
  view: CognitiveAgentLibraryView = 'active',
) {
  const [agents, setAgents] = useState<CognitiveAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const rows =
        view === 'deleted'
          ? await listDeletedCognitiveAgents()
          : await listMyCognitiveAgents();

      setAgents(rows);
    } catch (reason) {
      setAgents([]);
      setError(
        reason instanceof Error
          ? reason.message
          : view === 'deleted'
            ? localizeText('cognitive.deletedLoadFailed')
            : localizeText('cognitive.loadFailed'),
      );
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    if (autoLoad) {
      void refresh();
    }
  }, [autoLoad, refresh]);

  return {
    agents,
    loading,
    error,
    refresh,
  };
}
