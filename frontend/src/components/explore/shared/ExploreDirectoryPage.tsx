import { useLocalize } from '../../../localization/useLocalize';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveMcpRequestError } from '../../../lib/mcp-request-error';
import { runExploreResourceAction } from '../explore.actions';
import type { ExploreResourceItem } from '../explore.types';
import { ExploreResourceGrid } from './ExploreResourceCard';

export default function ExploreDirectoryPage({
  heading,
  query,
    loadItems,
}: {
  heading: string;
  query: string;

  loadItems: (query: string) => Promise<ExploreResourceItem[]>;
}) {
  const localize = useLocalize();
  const [items, setItems] = useState<ExploreResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError(null);
    try {
      const nextItems = await loadItems(query.trim());
      if (requestVersion.current !== version) return;
      setItems(nextItems);
    } catch (cause) {
      if (requestVersion.current !== version) return;
      setItems([]);
      setError(resolveMcpRequestError(cause, 'errors.explore.loadFailed'));
    } finally {
      if (requestVersion.current === version) {
        setLoading(false);
      }
    }
  }, [loadItems, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [load]);

  const act = async (item: ExploreResourceItem) => {
    setBusyId(item.id);
    setError(null);
    try {
      await runExploreResourceAction(item);
      await load();
    } catch (cause) {
      setError(resolveMcpRequestError(cause, 'errors.operationFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="w-full min-w-0 pb-[10px] pt-[10px]">
      <div className="pb-4 text-[13px] font-medium opacity-65">
        {query.trim() ? localize('explore.searchResults') : heading}
      </div>

      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center text-[12px] opacity-50">{localize('explore.loading')}</div>
      ) : error ? (
        <div className="flex min-h-[320px] items-center justify-center text-[12px] text-red-500">{error}</div>
      ) : items.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center text-[12px] opacity-50">{localize('explore.empty')}</div>
      ) : (
        <ExploreResourceGrid
          items={items}

          busyId={busyId}
          onAction={act}
        />
      )}
    </section>
  );
}
