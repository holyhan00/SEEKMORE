                                                             

import type { MemoryFactRecord } from './memory.types';
import { useFormatter } from '../../../localization/useFormatter';
import { useLocalize } from '../../../localization/useLocalize';

function shortId(
  value: string | null | undefined,
) {
  if (!value) return '—';

  return value.length <= 8
    ? value
    : value.slice(-6);
}

function statusClass(
  status: MemoryFactRecord['status'],
) {
  if (status === 'active') {
    return 'bg-[#DCFCE7] text-[#047857] dark:bg-[#123C2A] dark:text-emerald-300';
  }

  if (
    status ===
    'pending_confirmation'
  ) {
    return 'bg-[#FEF3C7] text-[#B45309] dark:bg-[#4A3412] dark:text-amber-300';
  }

  if (status === 'deleted') {
    return 'bg-[#FEE2E2] text-[#DC2626] dark:bg-[#4A1F1F] dark:text-red-300';
  }

  return 'bg-[#ECECEC] text-theme-balanced-60 dark:bg-[#3A3A3A] ';
}

function actionClass() {
  return 'flex h-[30px] w-[50px] select-none items-center justify-center whitespace-nowrap rounded-[8px] text-[10px] leading-none text-theme-reading transition hover:bg-[#0c5cfb] hover:text-[#ffffff] disabled:opacity-40 dark:flex dark:h-[30px] dark:w-[50px] dark:select-none dark:items-center dark:justify-center dark:whitespace-nowrap dark:rounded-[8px] dark:text-[10px] dark:leading-none  dark:transition dark:hover:bg-[#0c5cfb] dark:hover:text-[#ffffff] dark:disabled:opacity-40';
}

function dangerActionClass() {
  return 'flex h-[30px] w-[50px] select-none items-center justify-center whitespace-nowrap rounded-[8px] text-[10px] leading-none text-red-500 transition hover:bg-[#0c5cfb] hover:text-[#ffffff] disabled:opacity-40 dark:flex dark:h-[30px] dark:w-[50px] dark:select-none dark:items-center dark:justify-center dark:whitespace-nowrap dark:rounded-[8px] dark:text-[10px] dark:leading-none dark:text-red-300 dark:transition dark:hover:bg-[#0c5cfb] dark:hover:text-[#ffffff] dark:disabled:opacity-40';
}

export function MemoryListItem(
  props: {
    item: MemoryFactRecord;

    busy?: boolean;
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
  },
) {
  const localize = useLocalize();
  const formatter = useFormatter();
  const item = props.item;

  const enumLabel = (
    prefix: string,
    value: string,
  ): string => {
    const key =
      `${prefix}.${value}`;

    const translated =
      localize(key);

    return translated === key
      ? value
      : translated;
  };

  const sourceLabel =
    (): string => {
      const namespace =
        item.namespace;

      if (
        item.scopeLevel === 'user'
      ) {
        return localize(
          'memory.source.user',
        );
      }

      if (
        item.scopeLevel === 'agent'
      ) {
        return localize(
          'memory.source.agent',
          {
            id: shortId(
              namespace.agentId,
            ),
          },
        );
      }

      if (
        item.scopeLevel ===
        'conversation'
      ) {
        return localize(
          'memory.source.conversation',
          {
            id: shortId(
              namespace.conversationId,
            ),
          },
        );
      }

      return enumLabel(
        'memory.scope',
        item.scopeLevel,
      );
    };

  const formatTime = (
    value:
      | string
      | null
      | undefined,
  ): string => {
    if (!value) return '—';

    const date =
      new Date(value);

    if (
      !Number.isFinite(
        date.getTime(),
      )
    ) {
      return '—';
    }

    return formatter.formatDateTime(
      date,
      {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      },
    );
  };

  const cardClass =
    'bg-[#ffffff] hover:bg-[#d3d3d3] dark:bg-[#2A2A2A] dark:hover:bg-[#303030]';

  const muted =
    'text-theme-balanced-45 ';

  const strong =
    'text-[#111] dark:text-[#ffffff]';

  const tagClass =
    'bg-[#ECECEC] text-theme-balanced-60 dark:bg-[#3A3A3A] ';

  return (
    <div
      className={`min-h-[90px] rounded-[16px] px-[10px] py-[10px] transition ${cardClass}`}
    >
      <div className="flex h-full min-w-0 items-center">
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 shrink-0 items-center gap-[6px] overflow-hidden">
            <span
              className={`shrink-0 select-none whitespace-nowrap rounded-[8px] px-[4px] py-[4px]  text-[10px] leading-none ${statusClass(
                item.status,
              )}`}
            >
              {enumLabel(
                'memory.status',
                item.status,
              )}
            </span>

            <span
              className={`shrink-0 select-none whitespace-nowrap rounded-[8px] px-[4px] py-[4px] text-[10px] leading-none ${tagClass}`}
            >
              {enumLabel(
                'memory.kind',
                item.kind,
              )}
            </span>

            <span
              className={`shrink-0 select-none whitespace-nowrap rounded-[8px] px-[4px] py-[4px] text-[10px] leading-none ${tagClass}`}
            >
              {enumLabel(
                'memory.scope',
                item.scopeLevel,
              )}
            </span>

            <span
              className={`shrink-0 select-none whitespace-nowrap rounded-[8px] px-[4px] py-[4px] text-[10px] leading-none ${tagClass}`}
            >
              {enumLabel(
                'memory.sensitivity',
                item.sensitivity,
              )}
            </span>
          </div>

          <div
            className={`mt-[8px] break-words text-[10px] font-medium leading-[1.5] ${strong}`}
          >
            {item.summary ||
              `${item.subject} ${item.predicate}`}
          </div>

          <div
            className={`mt-[8px] flex min-w-0 shrink-0 items-center gap-x-4 overflow-hidden text-[10px] ${muted}`}
          >
            <span className="shrink-0">
              {sourceLabel()}
            </span>

            <span className="shrink-0">
              {localize(
                'memory.updatedAt',
                {
                  date: formatTime(
                    item.updatedAt,
                  ),
                },
              )}
            </span>

            <span className="shrink-0">
              {localize(
                'memory.usageCount',
                {
                  count:
                    item.usageCount,
                },
              )}
            </span>
          </div>
        </div>

        <div className="flex h-full w-[60px] shrink-0 flex-col items-end justify-center gap-[8px] pr-[10px] opacity-80 transition group-hover:opacity-100">
          {item.status ===
          'pending_confirmation' ? (
            <button
              disabled={props.busy}
              onClick={() =>
                props.onPromote(
                  item,
                )
              }
              className={actionClass()}
            >
              {localize(
                'memory.action.promote',
              )}
            </button>
          ) : null}

          {item.status ===
          'deleted' ? (
            <>
              <button
                disabled={
                  props.busy
                }
                onClick={() =>
                  props.onRestore(
                    item,
                  )
                }
                className={actionClass()}
              >
                {localize(
                  'memory.action.restore',
                )}
              </button>

              <button
                disabled={
                  props.busy
                }
                onClick={() =>
                  props.onPurge(
                    item,
                  )
                }
                className={
                  dangerActionClass()
                }
              >
                {localize(
                  'memory.action.purge',
                )}
              </button>
            </>
          ) : (
            <button
              disabled={props.busy}
              onClick={() =>
                props.onDelete(
                  item,
                )
              }
              className={
                dangerActionClass()
              }
            >
              {localize(
                'memory.action.delete',
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}