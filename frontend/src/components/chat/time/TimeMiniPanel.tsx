                                                      

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  TimeItem,
  TimeItemKind,
  TimeNotificationRecord,
} from './time.types';
import type { TimeItemAction } from './time.api';
import { useTimeReminder } from './useTimeReminder';
import TimeCard, {
  TimeCardTime,
} from './TimeCard';
import { useFormatter } from '../../../localization/useFormatter';
import { useLocalize } from '../../../localization/useLocalize';

interface TimeMiniPanelProps {
  visible: boolean;
  x: number;
  y: number;

  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

type DueEntry = {
  key: string;
  item: TimeItem | null;
  notification: TimeNotificationRecord | null;
};

type NotificationWithItemReference =
  TimeNotificationRecord & {
    itemId?: unknown;
    timeItemId?: unknown;
    sourceItemId?: unknown;
  };

        
const PANEL_WIDTH = 240;
const PANEL_HEIGHT = 220;
const PANEL_OFFSET_X = 80;
const PANEL_OFFSET_Y = 0;
const PANEL_EDGE_GAP = 8;
const PANEL_MIN_TOP = 52;

         
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDuration(
  milliseconds: number,
): string {
  const totalSeconds = Math.max(
    0,
    Math.floor(milliseconds / 1_000),
  );

  const hours = Math.floor(
    totalSeconds / 3_600,
  );

  const minutes = Math.floor(
    (totalSeconds % 3_600) / 60,
  );

  const seconds =
    totalSeconds % 60;

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

type Localize = (
  key: string,
  values?: Record<string, unknown>,
) => string;

type DateTimeFormatter = (
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
) => string;

function kindLabel(
  kind: TimeItemKind,
  localize: Localize,
): string {
  return localize(
    `time.kind.${kind}`,
  );
}

function displayTime(
  item: TimeItem,
  nowMs: number,
  formatDateTime: DateTimeFormatter,
  localize: Localize,
): string {
  if (item.kind === 'stopwatch') {
    const live =
      item.status === 'running' &&
      item.startedAt
        ? item.elapsedMs +
          Math.max(
            0,
            nowMs -
              new Date(
                item.startedAt,
              ).getTime(),
          )
        : item.liveElapsedMs;

    return formatDuration(live);
  }

  if (
    item.kind === 'countdown'
  ) {
    if (
      item.status === 'paused'
    ) {
      return formatDuration(
        item.remainingMs ??
          item.liveRemainingMs ??
          0,
      );
    }

    if (item.triggerAt) {
      return formatDuration(
        Math.max(
          0,
          new Date(
            item.triggerAt,
          ).getTime() - nowMs,
        ),
      );
    }
  }

  if (item.triggerAt) {
    return formatDateTime(
      item.triggerAt,
      {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
    );
  }

  return item.status === 'triggered'
    ? localize(
        'time.status.triggered',
      )
    : localize(
        'time.status.running',
      );
}

function statusLabel(
  item: TimeItem,
  localize: Localize,
): string {
  const key =
    `time.status.${item.status}`;

  const translated =
    localize(key);

  return translated === key
    ? item.status
    : translated;
}

function actionsFor(
  item: TimeItem,
  localize: Localize,
): Array<{
  action: TimeItemAction;
  label: string;
  snoozeMs?: number;
}> {
  if (
    item.status === 'triggered'
  ) {
    return [
      {
        action: 'snooze',
        label: localize(
          'time.action.snooze5Full',
        ),
        snoozeMs: 300_000,
      },
      {
        action: 'complete',
        label: localize(
          'time.action.complete',
        ),
      },
    ];
  }

  if (
    item.kind === 'stopwatch'
  ) {
    return item.status ===
      'paused'
      ? [
          {
            action: 'resume',
            label: localize(
              'time.action.resume',
            ),
          },
          {
            action: 'stop',
            label: localize(
              'time.action.stop',
            ),
          },
        ]
      : [
          {
            action: 'pause',
            label: localize(
              'time.action.pause',
            ),
          },
          {
            action: 'stop',
            label: localize(
              'time.action.stop',
            ),
          },
        ];
  }

  if (
    item.kind === 'countdown'
  ) {
    return item.status ===
      'paused'
      ? [
          {
            action: 'resume',
            label: localize(
              'time.action.resume',
            ),
          },
          {
            action: 'cancel',
            label: localize(
              'time.action.cancel',
            ),
          },
        ]
      : [
          {
            action: 'pause',
            label: localize(
              'time.action.pause',
            ),
          },
          {
            action: 'cancel',
            label: localize(
              'time.action.cancel',
            ),
          },
        ];
  }

  if (
    item.status === 'paused'
  ) {
    return [
      {
        action: 'resume',
        label: localize(
          'time.action.resume',
        ),
      },
      {
        action: 'cancel',
        label: localize(
          'time.action.cancel',
        ),
      },
    ];
  }

  return [
    {
      action: 'cancel',
      label: localize(
        'time.action.cancel',
      ),
    },
  ];
}

function notificationItemId(
  notification: TimeNotificationRecord,
): string | null {
  const candidate =
    notification as NotificationWithItemReference;

  const value =
    candidate.timeItemId ??
    candidate.itemId ??
    candidate.sourceItemId;

  if (
    typeof value !== 'string'
  ) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized || null;
}

function matchesNotification(
  item: TimeItem,
  notification: TimeNotificationRecord,
): boolean {
  const referencedItemId =
    notificationItemId(
      notification,
    );

  if (referencedItemId) {
    return (
      item.id ===
      referencedItemId
    );
  }

  return (
    item.kind ===
      notification.kind &&
    item.title.trim() ===
      notification.title.trim()
  );
}

function sortTimeItems(
  left: TimeItem,
  right: TimeItem,
): number {
  const leftTime =
    left.triggerAt
      ? new Date(
          left.triggerAt,
        ).getTime()
      : Number.MAX_SAFE_INTEGER;

  const rightTime =
    right.triggerAt
      ? new Date(
          right.triggerAt,
        ).getTime()
      : Number.MAX_SAFE_INTEGER;

  return leftTime - rightTime;
}

const TimeMiniPanel: React.FC<
  TimeMiniPanelProps
> = ({
  visible,
  x,
  y,
  onClose,
  triggerRef,
}) => {
  const localize =
    useLocalize();

  const {
    formatDateTime,
  } = useFormatter();

  const panelRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const [
    nowMs,
    setNowMs,
  ] = useState(Date.now());

  const [
    pendingDueKey,
    setPendingDueKey,
  ] =
    useState<string | null>(
      null,
    );

  const {
    items,
    notifications,
    loading,
    actionId,
    error,
    refresh,
    performAction,
    acknowledge,
  } = useTimeReminder();

  const surfaceClass =
    'bg-surface-control text-theme-strong dark:border dark:border-[#454545]  ';

  const mutedClass =
    'text-[#686868] dark:text-[#a8a8a8]';

  const buttonHoverClass = `
    hover:bg-[#0a4fe0]
    hover:text-[#ffffff]
  `;

  const primaryButtonClass = `
    bg-action-primary
    text-[#ffffff]
    ${buttonHoverClass}
  `;

                                               
  const secondaryButtonClass = `
    bg-[#e2e2e2]
    text-theme-primary
    dark:bg-[#3a3a3a]
    
    ${buttonHoverClass}
  `;

  useEffect(() => {
    const timer =
      window.setInterval(
        () =>
          setNowMs(
            Date.now(),
          ),
        1_000,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }

    void refresh(true);
  }, [
    visible,
    refresh,
  ]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const handleMouseDown = (
      event: MouseEvent,
    ) => {
      const target =
        event.target as Node;

      if (
        panelRef.current?.contains(
          target,
        )
      ) {
        return;
      }

      if (
        triggerRef?.current?.contains(
          target,
        )
      ) {
        return;
      }

      onClose();
    };

    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === 'Escape'
      ) {
        onClose();
      }
    };

    const frame =
      requestAnimationFrame(
        () => {
          document.addEventListener(
            'mousedown',
            handleMouseDown,
          );

          document.addEventListener(
            'keydown',
            handleKeyDown,
          );
        },
      );

    return () => {
      cancelAnimationFrame(
        frame,
      );

      document.removeEventListener(
        'mousedown',
        handleMouseDown,
      );

      document.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [
    visible,
    onClose,
    triggerRef,
  ]);

  const triggeredItems =
    useMemo(
      () =>
        items
          .filter(
            (item) =>
              item.status ===
              'triggered',
          )
          .sort(
            sortTimeItems,
          ),
      [items],
    );

  const recordingItems =
    useMemo(
      () =>
        items
          .filter(
            (item) =>
              item.status !==
              'triggered',
          )
          .sort(
            sortTimeItems,
          ),
      [items],
    );

  const dueEntries =
    useMemo<
      DueEntry[]
    >(() => {
      const result: DueEntry[] =
        [];

      const usedItemIds =
        new Set<string>();

      const usedKeys =
        new Set<string>();

      for (
        const notification of
        notifications
      ) {
        const matchedItem =
          triggeredItems.find(
            (item) =>
              !usedItemIds.has(
                item.id,
              ) &&
              matchesNotification(
                item,
                notification,
              ),
          ) ?? null;

        const key =
          matchedItem
            ? `item:${matchedItem.id}`
            : `notification:${notification.id}`;

        if (
          usedKeys.has(key)
        ) {
          continue;
        }

        usedKeys.add(key);

        if (matchedItem) {
          usedItemIds.add(
            matchedItem.id,
          );
        }

        result.push({
          key,
          item: matchedItem,
          notification,
        });
      }

      for (
        const item of
        triggeredItems
      ) {
        if (
          usedItemIds.has(
            item.id,
          )
        ) {
          continue;
        }

        const key =
          `item:${item.id}`;

        if (
          usedKeys.has(key)
        ) {
          continue;
        }

        usedKeys.add(key);

        result.push({
          key,
          item,
          notification: null,
        });
      }

      return result;
    }, [
      notifications,
      triggeredItems,
    ]);

  const handleDueAction =
    useCallback(
      async (
        entry: DueEntry,
        action:
          | 'snooze'
          | 'complete',
        snoozeMs?: number,
      ) => {
        if (pendingDueKey) {
          return;
        }

        setPendingDueKey(
          entry.key,
        );

        try {
          if (entry.item) {
            await performAction(
              entry.item,
              action,
              snoozeMs,
            );
          }

          if (
            entry.notification
          ) {
            await acknowledge(
              entry.notification,
            );
          }

          await refresh(false);
        } finally {
          setPendingDueKey(
            null,
          );
        }
      },
      [
        pendingDueKey,
        performAction,
        acknowledge,
        refresh,
      ],
    );

  if (!visible) {
    return null;
  }

  const resolvedTop =
    Math.max(
      PANEL_MIN_TOP,
      Math.min(
        y + PANEL_OFFSET_Y,
        window.innerHeight -
          PANEL_HEIGHT -
          PANEL_EDGE_GAP,
      ),
    );

  const resolvedLeft =
    Math.max(
      PANEL_EDGE_GAP,
      Math.min(
        x + PANEL_OFFSET_X,
        window.innerWidth -
          PANEL_WIDTH -
          PANEL_EDGE_GAP,
      ),
    );

  return createPortal(
    <div
      ref={panelRef}
      data-desktop-no-drag
      className={`
        flex
        flex-col
        !select-none
        overflow-hidden
        rounded-[12px]
        shadow-xl
        [&_button]:!select-none
        [&_button_*]:!select-none
        ${surfaceClass}
      `}
      style={{
        position: 'fixed',
        top: resolvedTop,
        left: resolvedLeft,
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        zIndex: 10001,
        boxShadow:
          '0 8px 24px rgba(0, 0, 0, 0.16)',
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <header
        className="
          flex
          shrink-0
          items-start
          justify-between
          px-[10px]
          pb-[5px]
          pt-[5px]
        "
      >
        <div className="min-w-0">
          <div
            className="
              mt-[5px]
              text-[15px]
              font-semibold
              leading-none
              tracking-[-0.03em]
            "
          >
            {localize(
              'time.title',
            )}
          </div>

          <div
            className={`
              mt-[4px]
              truncate
              text-[7px]
              leading-none
              ${mutedClass}
            `}
          >
            {localize(
              'time.description',
            )}
          </div>
        </div>

        <button
          type="button"
          className={`
            flex
            h-5
            min-w-[34px]
            shrink-0
            items-center
            justify-center
            rounded-[7px]
            px-[7px]
            py-0
            text-[8px]
            font-medium
            leading-none
            transition
            disabled:cursor-not-allowed
            disabled:opacity-50
            ${primaryButtonClass}
          `}
          onClick={() => {
            void refresh(true);
          }}
          disabled={loading}
        >
          {loading
            ? localize(
                'time.refreshing',
              )
            : localize(
                'time.refresh',
              )}
        </button>
      </header>

      {error && (
        <div
          className="
            mx-[5px]
            mb-[5px]
            shrink-0
            truncate
            rounded-[5px]
            bg-red-500/10
            px-[5px]
            py-[5px]
            text-[7px]
            leading-none
            text-red-500
          "
          title={error}
        >
          {error}
        </div>
      )}

      <div
        className="
          min-h-0
          flex-1
          overflow-y-auto
          overscroll-contain
          px-[5px]
          pb-[5px]
        "
      >
        <section>
          <div
            className="
              mb-[3px]
              mt-[8px]
              px-[5px]
              text-[9px]
              font-medium
              leading-none
            "
          >
            {localize(
              'time.section.due',
            )}
          </div>

          {dueEntries.length ===
          0 ? (
            <TimeCard
              emptyText={localize(
                'time.empty.due',
              )}
            />
          ) : (
            <div className="space-y-1">
              {dueEntries.map(
                (entry) => {
                  const item =
                    entry.item;

                  const notification =
                    entry.notification;

                  const rawTitle =
                    notification?.title?.trim() ||
                    item?.title?.trim() ||
                    '';

                  const title =
                    rawTitle ||
                    (item
                      ? kindLabel(
                          item.kind,
                          localize,
                        )
                      : localize(
                          'time.defaultReminderTitle',
                        ));

                  const body =
                    notification?.body ??
                    (item
                      ? `${kindLabel(
                          item.kind,
                          localize,
                        )} · ${statusLabel(
                          item,
                          localize,
                        )}`
                      : localize(
                          'time.reminderDue',
                        ));

                  const kind =
                    item?.kind ??
                    notification?.kind;

                  const isPending =
                    pendingDueKey ===
                      entry.key ||
                    Boolean(
                      item &&
                        actionId ===
                          item.id,
                    );

                  return (
                    <TimeCard
                      key={
                        entry.key
                      }
                      actions={
                        <>
                          {item && (
                            <button
                              type="button"
                              className={`
                                h-[18px]
                                rounded-[6px]
                                px-[10px]
                                text-[6px]
                                font-medium
                                leading-none
                                transition
                                disabled:cursor-not-allowed
                                disabled:opacity-50
                                ${secondaryButtonClass}
                              `}
                              disabled={
                                isPending
                              }
                              onClick={() => {
                                void handleDueAction(
                                  entry,
                                  'snooze',
                                  300_000,
                                );
                              }}
                            >
                              {isPending
                                ? localize(
                                    'time.action.processing',
                                  )
                                : localize(
                                    'time.action.snooze5',
                                  )}
                            </button>
                          )}

                          <button
                            type="button"
                            className={`
                              h-[18px]
                              rounded-[6px]
                              px-[5px]
                              text-[7px]
                              font-medium
                              leading-none
                              transition
                              disabled:cursor-not-allowed
                              disabled:opacity-50
                              ${primaryButtonClass}
                            `}
                            disabled={
                              isPending
                            }
                            onClick={() => {
                              void handleDueAction(
                                entry,
                                'complete',
                              );
                            }}
                          >
                            {isPending
                              ? localize(
                                  'time.action.processing',
                                )
                              : localize(
                                  'time.action.complete',
                                )}
                          </button>
                        </>
                      }
                    >
                      <div
                        className="
                          flex
                          min-w-0
                          items-start
                          justify-between
                          gap-2
                        "
                      >
                        <div className="min-w-0">
                          <div
                            className="
                              truncate
                              mt-[2px]
                              text-[12px]
                              font-medium
                              leading-tight
                              tracking-[-0.01em]
                            "
                            title={
                              title
                            }
                          >
                            {title}
                          </div>

                          <div
                            className={`
                              mt-[2px]
                              line-clamp-1
                              text-[8px]
                              leading-[10px]
                              ${mutedClass}
                            `}
                            title={
                              body
                            }
                          >
                            {body}
                          </div>

                          {kind && (
                            <div
                              className={`
                                mt-[8px]
                                text-[8px]
                                leading-none
                                ${mutedClass}
                              `}
                            >
                              {kindLabel(
                                kind,
                                localize,
                              )}{' '}
                              ·{' '}
                              {localize(
                                'time.status.triggered',
                              )}
                            </div>
                          )}
                        </div>

                        <TimeCardTime
                          isDue
                        >
                          {item
                            ? displayTime(
                                item,
                                nowMs,
                                formatDateTime,
                                localize,
                              )
                            : localize(
                                'time.status.triggered',
                              )}
                        </TimeCardTime>
                      </div>
                    </TimeCard>
                  );
                },
              )}
            </div>
          )}
        </section>

        <section className="mt-[10px]">
          <div
            className="
              mb-[5px]
              mt-[18px]
              px-[5px]
              text-[9px]
              font-medium
              leading-none
            "
          >
            {localize(
              'time.section.records',
            )}
          </div>

          {recordingItems.length ===
          0 ? (
            <TimeCard
              emptyText={localize(
                'time.empty.records',
              )}
            />
          ) : (
            <div className="space-y-1">
              {recordingItems.map(
                (item) => (
                  <TimeCard
                    key={item.id}
                    actions={
                      <>
                        {actionsFor(
                          item,
                          localize,
                        ).map(
                          (action) => (
                            <button
                              key={
                                action.action
                              }
                              type="button"
                              className={`
                                h-[18px]
                                rounded-[6px]
                                px-2.5
                                text-[7px]
                                font-medium
                                leading-none
                                transition
                                disabled:cursor-not-allowed
                                disabled:opacity-50
                                ${primaryButtonClass}
                              `}
                              disabled={
                                actionId ===
                                item.id
                              }
                              onClick={() => {
                                void performAction(
                                  item,
                                  action.action,
                                  action.snoozeMs,
                                );
                              }}
                            >
                              {actionId ===
                              item.id
                                ? localize(
                                    'time.action.processing',
                                  )
                                : action.label}
                            </button>
                          ),
                        )}
                      </>
                    }
                  >
                    <div
                      className="
                        flex
                        min-w-0
                        items-start
                        justify-between
                        gap-2
                      "
                    >
                      <div className="min-w-0">
                        <div
                          className="
                            truncate
                            text-[10px]
                            font-medium
                            leading-tight
                            tracking-[-0.01em]
                          "
                          title={
                            item.title ||
                            kindLabel(
                              item.kind,
                              localize,
                            )
                          }
                        >
                          {item.title ||
                            kindLabel(
                              item.kind,
                              localize,
                            )}
                        </div>

                        <div
                          className={`
                            mt-[4px]
                            flex
                            items-center
                            gap-1
                            text-[7px]
                            leading-none
                            ${mutedClass}
                          `}
                        >
                          <span>
                            {kindLabel(
                              item.kind,
                              localize,
                            )}
                          </span>

                          <span>·</span>

                          <span>
                            {statusLabel(
                              item,
                              localize,
                            )}
                          </span>
                        </div>
                      </div>

                      <TimeCardTime>
                        {displayTime(
                          item,
                          nowMs,
                          formatDateTime,
                          localize,
                        )}
                      </TimeCardTime>
                    </div>
                  </TimeCard>
                ),
              )}
            </div>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
};

export default TimeMiniPanel;