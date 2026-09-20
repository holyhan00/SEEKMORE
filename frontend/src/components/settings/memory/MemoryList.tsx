                                                         

import { useLocalize } from '../../../localization/useLocalize';
import type { MemoryFactRecord } from './memory.types';
import { MemoryListItem } from './MemoryListItem';

export function MemoryList(props: {
  items: MemoryFactRecord[];

  loading: boolean;
  error: string | null;
  busyId: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onDelete: (
    item: MemoryFactRecord,
  ) => void;
  onRestore: (
    item: MemoryFactRecord,
  ) => void;
  onPromote: (
    item: MemoryFactRecord,
  ) => void;
  onPurge: (
    item: MemoryFactRecord,
  ) => void;
}) {
  const localize = useLocalize();

  const emptyClass =
    'text-theme-balanced-45 ';

  const moreClass =
    'bg-[#000000]/5 text-theme-reading hover:bg-[#0c5cfb] hover:text-[#ffffff] dark:bg-[#ffffff]/6 dark:hover:bg-[#0c5cfb] dark:hover:text-[#ffffff]';

  if (props.error) {
    return (
      <div
        className={`rounded-[14px] px-[10px] py-[12px] text-center text-[10px] ${emptyClass}`}
      >
        {props.error}
      </div>
    );
  }

  if (
    props.loading &&
    !props.items.length
  ) {
    return (
      <div
        className={`rounded-[14px] px-[10px] py-[12px] text-center text-[10px] ${emptyClass}`}
      >
        {localize(
          'common.loading',
        )}
      </div>
    );
  }

  if (!props.items.length) {
    return (
      <div
        className={`rounded-[14px] px-[10px] py-[12px] text-center text-[10px] ${emptyClass}`}
      >
        {localize(
          'memory.empty',
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-[10px]">
        {props.items.map(
          (item) => (
            <MemoryListItem
              key={item.id}
              item={item}
              busy={
                props.busyId ===
                item.id
              }
              onDelete={
                props.onDelete
              }
              onRestore={
                props.onRestore
              }
              onPromote={
                props.onPromote
              }
              onPurge={
                props.onPurge
              }
            />
          ),
        )}
      </div>

      {props.hasMore ? (
        <button
          onClick={
            props.onLoadMore
          }
          disabled={
            props.loading
          }
          className={`mt-[10px] h-[40px] w-full select-none rounded-[13px] text-[10px] transition disabled:opacity-50 ${moreClass}`}
        >
          {props.loading
            ? localize(
                'common.loading',
              )
            : localize(
                'memory.loadMore',
              )}
        </button>
      ) : null}
    </div>
  );
}