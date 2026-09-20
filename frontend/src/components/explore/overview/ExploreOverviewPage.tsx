import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveMcpRequestError } from '../../../lib/mcp-request-error';
import { useLocalize } from '../../../localization/useLocalize';
import { runExploreResourceAction } from '../explore.actions';
import {
  listExploreAgents,
  listExploreSkills,
  listFeaturedResources,
  listPopularResources,
} from '../explore.api';
import type { ExploreResourceItem } from '../explore.types';
import { ExploreResourceGrid } from '../shared/ExploreResourceCard';

function uniqueResources(items: ExploreResourceItem[]): ExploreResourceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.resourceType}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ResourceSection({
  title,
  items,
    busyId,
  onAction,
}: {
  title: string;
  items: ExploreResourceItem[];

  busyId: string | null;
  onAction: (item: ExploreResourceItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <div className="pb-4 text-[13px] font-medium opacity-65">{title}</div>
      <ExploreResourceGrid
        items={items}

        busyId={busyId}
        onAction={onAction}
      />
    </section>
  );
}

export default function ExploreOverviewPage({
  query,
  }: {
  query: string;

}) {
  const localize = useLocalize();
  const [featured, setFeatured] = useState<ExploreResourceItem[]>([]);
  const [popular, setPopular] = useState<ExploreResourceItem[]>([]);
  const [searchResults, setSearchResults] = useState<ExploreResourceItem[]>([]);
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
      const keyword = query.trim();
      if (keyword) {
        const results = await Promise.all([
          listExploreAgents(keyword),
          listExploreSkills(keyword),
        ]);
        if (requestVersion.current !== version) return;
        setSearchResults(uniqueResources(results.flat()));
        setFeatured([]);
        setPopular([]);
      } else {
        const [nextFeatured, nextPopular] = await Promise.all([
          listFeaturedResources(),
          listPopularResources(),
        ]);
        if (requestVersion.current !== version) return;
        setFeatured(uniqueResources(nextFeatured));
        setPopular(uniqueResources(nextPopular));
        setSearchResults([]);
      }
    } catch (cause) {
      if (requestVersion.current !== version) return;
      setFeatured([]);
      setPopular([]);
      setSearchResults([]);
      setError(resolveMcpRequestError(cause, 'errors.explore.loadFailed'));
    } finally {
      if (requestVersion.current === version) {
        setLoading(false);
      }
    }
  }, [query]);

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

  const hasContent = query.trim()
    ? searchResults.length > 0
    : featured.length > 0 || popular.length > 0;

  return (
    <div className="w-full min-w-0 pb-[10px] pt-[10px]">
      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center text-[12px] opacity-50">{localize('common.loading')}</div>
      ) : error ? (
        <div className="flex min-h-[320px] items-center justify-center text-[12px] text-red-500">{error}</div>
      ) : !hasContent ? (
        <div className="flex min-h-[320px] items-center justify-center text-[12px] opacity-50">{localize('explore.empty')}</div>
      ) : query.trim() ? (
        <ResourceSection
          title={localize('explore.searchResults')}
          items={searchResults}

          busyId={busyId}
          onAction={act}
        />
      ) : (
        <div className="space-y-9">
          <ResourceSection
            title={localize('explore.featured')}
            items={featured}

            busyId={busyId}
            onAction={act}
          />
          <ResourceSection
            title={localize('explore.popular')}
            items={popular}

            busyId={busyId}
            onAction={act}
          />
        </div>
      )}
    </div>
  );
}
