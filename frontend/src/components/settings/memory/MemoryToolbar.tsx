                                                            
import { useLocalize } from '../../../localization/useLocalize';
import type {
  MemoryStatusFilter,
} from './memory.types';

const STATUS_OPTIONS: Array<{
  key: MemoryStatusFilter;
  labelKey: string;
}> = [
  {
    key: 'active',
    labelKey:
      'memory.status.active',
  },
  {
    key:
      'pending_confirmation',
    labelKey:
      'memory.status.pending_confirmation',
  },
  {
    key: 'superseded',
    labelKey:
      'memory.status.superseded',
  },
  {
    key: 'deleted',
    labelKey:
      'memory.status.deleted',
  },
];

export function MemoryToolbar(props: {

  status: MemoryStatusFilter;
  keyword: string;
  onStatusChange: (
    status: MemoryStatusFilter,
  ) => void;
  onKeywordChange: (
    keyword: string,
  ) => void;
  onRefresh: () => void;
}) {
  const localize = useLocalize();

  const inputClass =
    'bg-surface-raised text-theme-strong placeholder:text-[#000000]/35 border-edge-alpha-10   dark:placeholder:text-[#ffffff]/35 ';

  return (
    <div>
      <div className="mb-[10px] flex flex-wrap gap-[8px]">
        {STATUS_OPTIONS.map(
          (item) => {
            const active =
              props.status ===
              item.key;

            return (
              <button
                key={item.key}
                onClick={() =>
                  props.onStatusChange(
                    item.key,
                  )
                }
                className={
                  active
                    ? 'h-[30px] rounded-[10px] bg-[#FA5151] px-[10px] select-none text-[10px] font-medium text-[#ffffff]'
                    : 'h-[30px] rounded-[10px] bg-[#000000]/5 px-[10px] select-none text-[10px] text-theme-reading hover:bg-[#000000]/10 dark:h-[30px] dark:rounded-[10px] dark:bg-[#ffffff]/7 dark:px-[10px] dark:select-none dark:text-[10px]  dark:hover:bg-[#ffffff]/12'
                }
              >
                {localize(
                  item.labelKey,
                )}
              </button>
            );
          },
        )}
      </div>

      <div className="mb-[10px] flex items-center gap-[8px]">
        <input
          value={props.keyword}
          onChange={(event) =>
            props.onKeywordChange(
              event.target.value,
            )
          }
          placeholder={localize(
            'memory.searchPlaceholder',
          )}
          className={`h-[38px] min-w-0 flex-1 rounded-[14px] border pl-[14px] pr-[10px] text-[12px] outline-none transition ${inputClass}`}
        />

        <button
          onClick={props.onRefresh}
          className={
            'h-[38px] shrink-0 select-none rounded-[12px] bg-[#000000]/5 px-3 text-[10px] text-[#000000]/70 hover:bg-[#0C5CFB] hover:text-[#ffffff] dark:h-[38px] dark:shrink-0 dark:select-none dark:rounded-[12px] dark:bg-[#ffffff]/8 dark:px-3 dark:text-[10px] dark:text-[#ffffff]/80 dark:hover:bg-[#0C5CFB] dark:hover:text-[#ffffff]'
          }
        >
          {localize(
            'memory.refresh',
          )}
        </button>
      </div>
    </div>
  );
}