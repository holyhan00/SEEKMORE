import { resolveAssetUrl } from '../../../utils/asset-url';
                                                                  
import { useLocalize } from '../../../localization/useLocalize';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { confirm } from '../../../lib/confirm';
import { memoryApi } from './memory.api';
import { MemoryList } from './MemoryList';
import { MemoryToolbar } from './MemoryToolbar';
import type { MemoryFactRecord, MemoryStatusFilter } from './memory.types';

const PAGE_SIZE = 30;

type MemoryMutateAction = 'delete' | 'restore' | 'promote' | 'purge';

export default function MemorySettingsPanel(props: {  onBack?: () => void }) {
  const localize = useLocalize();
  const [status, setStatus] = useState<MemoryStatusFilter>('active');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<MemoryFactRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      status,
      keyword: keyword.trim() || null,
      limit: PAGE_SIZE,
    }),
    [status, keyword],
  );

  const load = useCallback(
    async (mode: 'reset' | 'more' = 'reset') => {
      setLoading(true);
      setError(null);

      try {
        const res = await memoryApi.listFacts({
          ...query,
          cursor: mode === 'more' ? cursor : null,
        });

        setItems((prev) => (mode === 'more' ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : localize('memory.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [cursor, localize, query],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load('reset'), 180);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  const refresh = useCallback(() => void load('reset'), [load]);

  const confirmMutation = useCallback(async (action: MemoryMutateAction) => {
    if (action === 'delete') {
      return confirm({
        title: localize('memory.confirm.forgetTitle'),
        description: localize('memory.confirm.forgetDescription'),
        confirmText: localize('memory.confirm.forget'),
        cancelText: localize('common.actions.cancel'),
        danger: true,
      });
    }

    if (action === 'purge') {
      return confirm({
        title: localize('memory.confirm.purgeTitle'),
        description: localize('memory.confirm.purgeDescription'),
        confirmText: localize('memory.confirm.purge'),
        cancelText: localize('common.actions.cancel'),
        danger: true,
      });
    }

    return true;
  }, [localize]);

  const mutate = useCallback(
    async (item: MemoryFactRecord, action: MemoryMutateAction) => {
      const ok = await confirmMutation(action);
      if (!ok) return;

      setBusyId(item.id);
      setError(null);

      try {
        if (action === 'delete') await memoryApi.deleteFact(item.id);
        if (action === 'restore') await memoryApi.restoreFact(item.id);
        if (action === 'promote') await memoryApi.promoteFact(item.id);
        if (action === 'purge') await memoryApi.purgeFact(item.id);

        await load('reset');
      } catch (err) {
        setError(err instanceof Error ? err.message : localize('memory.operationFailed'));
      } finally {
        setBusyId(null);
      }
    },
    [confirmMutation, load],
  );

  const panelClass = 'bg-surface-settings text-theme-strong  ';

  const cardClass = 'bg-[#FFFFFF] dark:bg-[#202020]';

  return (
    <div className={`relative h-full rounded-[16px] overflow-hidden ${panelClass}`}>
      <div className="flex h-full flex-col px-[12px] py-[10px]">
        <div className="mb-[10px] pt-[8px]">
          <div className="flex items-start justify-between gap-[8px]">
            <div className="min-w-0">
              <div className="select-none text-[20px] font-semibold leading-none">{localize('memory.savedTitle')}</div>
              <div
                className={
                  'mt-[10px] text-[12px] text-[#777] dark:mt-[10px] dark:text-[12px] dark:text-[#8B8B8B]'
                }
              >
                {localize('memory.savedDescription')}
              </div>
            </div>

            {props.onBack ? (
              <button
                type="button"
                onClick={props.onBack}
                aria-label={localize('memory.backToData')}
                className={
                  'group flex h-[30px] w-[40px] shrink-0 select-none items-center justify-center rounded-[10px] bg-surface-input transition hover:bg-[#0c5cfb] dark:group dark:flex dark:h-[30px] dark:w-[40px] dark:shrink-0 dark:select-none dark:items-center dark:justify-center dark:rounded-[10px]  dark:transition dark:hover:bg-[#0c5cfb]'
                }
              >
                <img
                  src={resolveAssetUrl('/icons/back.svg')}
                  alt=""
                  className="h-[16px] w-[16px] opacity-70 group-hover:hidden"
                />
                <img
                  src={resolveAssetUrl('/icons/white/back1.svg')}
                  alt=""
                  className="hidden h-[16px] w-[16px] group-hover:block"
                />
              </button>
            ) : null}
          </div>
        </div>

        <div className={`min-h-0 flex flex-1 flex-col rounded-[16px] p-[10px] overflow-hidden ${cardClass}`}>
          <MemoryToolbar

            status={status}
            keyword={keyword}
            onStatusChange={setStatus}
            onKeywordChange={setKeyword}
            onRefresh={refresh}
          />

          <MemoryList
            items={items}

            loading={loading}
            error={error}
            busyId={busyId}
            hasMore={Boolean(cursor)}
            onLoadMore={() => void load('more')}
            onDelete={(item) => void mutate(item, 'delete')}
            onRestore={(item) => void mutate(item, 'restore')}
            onPromote={(item) => void mutate(item, 'promote')}
            onPurge={(item) => void mutate(item, 'purge')}
          />
        </div>
      </div>
    </div>
  );
}