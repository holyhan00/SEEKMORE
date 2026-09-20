import { useLocalize } from '../../../localization/useLocalize';
                                                            
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  acknowledgeTimeNotification,
  fetchTimeSnapshot,
  runTimeItemAction,
  type TimeItemAction,
} from './time.api';
import type {
  TimeItem,
  TimeNotificationRecord,
} from './time.types';
import { useDesktopRuntime } from '../../../runtime/desktop/useDesktopRuntime';

const DELIVERED_OCCURRENCES_KEY =
  'seekmore:time:delivered-occurrences';

const AUTO_OPENED_OCCURRENCES_KEY =
  'seekmore:time:auto-opened-occurrences';

const RING_DURATION_MS = 10_000;
const POLL_INTERVAL_MS = 1_000;

type TimeReminderContextValue = {
  items: TimeItem[];
  notifications: TimeNotificationRecord[];
  activeCount: number;
  ringing: boolean;
  panelOpenRequested: boolean;
  consumePanelOpenRequest: () => void;
  loading: boolean;
  actionId: string | null;
  error: string | null;
  refresh: (showLoading?: boolean) => Promise<void>;
  performAction: (
    item: TimeItem,
    action: TimeItemAction,
    snoozeMs?: number,
  ) => Promise<void>;
  acknowledge: (
    record: TimeNotificationRecord,
  ) => Promise<void>;
};

export const TimeReminderContext =
  createContext<TimeReminderContextValue | null>(null);

export function TimeReminderProvider({
  children,
}: PropsWithChildren) {
  const localize = useLocalize();
  const desktopRuntime = useDesktopRuntime();

  const [items, setItems] = useState<TimeItem[]>([]);
  const [notifications, setNotifications] = useState<
    TimeNotificationRecord[]
  >([]);
  const [activeCount, setActiveCount] = useState(0);
  const [ringingIds, setRingingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [panelOpenRequested, setPanelOpenRequested] =
    useState(false);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const deliveredRef = useRef(
    readDeliveredOccurrences(),
  );

  const autoOpenedRef = useRef(
    readAutoOpenedOccurrences(),
  );

  const ringTimersRef = useRef(
    new Map<string, number>(),
  );

  const activeRingingRef = useRef(
    new Set<string>(),
  );

  const pendingDeliveryRef = useRef(
    new Set<string>(),
  );

  const refresh = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const snapshot = await fetchTimeSnapshot();

        setItems(snapshot.items);

        setNotifications(
          snapshot.notifications.filter(
            (item) => !item.acknowledgedAt,
          ),
        );

        setActiveCount(snapshot.activeCount);
        setError(null);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : localize('time.loadFailed'),
        );
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const stopNotificationRing = useCallback(
    async (notificationId: string) => {
      const timer =
        ringTimersRef.current.get(notificationId);

      if (timer !== undefined) {
        window.clearTimeout(timer);
        ringTimersRef.current.delete(notificationId);
      }

      activeRingingRef.current.delete(notificationId);

      setRingingIds(
        new Set(activeRingingRef.current),
      );

      if (
        desktopRuntime.phase === 'desktop-ready'
        && desktopRuntime.bridgeReady
        && desktopRuntime.capabilities.reminderRing
        && window.seekmoreDesktop?.reminder?.stopRing
      ) {
        try {
          await window.seekmoreDesktop.reminder.stopRing({
            notificationId,
          });
        } catch (reason) {
          console.error(
            '[TimeReminder] Failed to stop desktop ring',
            reason,
          );
        }
      }
    },
    [
      desktopRuntime.phase,
      desktopRuntime.bridgeReady,
      desktopRuntime.capabilities.reminderRing,
    ],
  );

  const startNotificationRing = useCallback(
    async (
      record: TimeNotificationRecord,
    ): Promise<boolean> => {
      if (
        activeRingingRef.current.has(record.id)
      ) {
        return true;
      }

        
                                   
                                                 
         
      if (desktopRuntime.isDesktop) {
        if (
          desktopRuntime.phase !== 'desktop-ready'
          || !desktopRuntime.bridgeReady
          || !desktopRuntime.capabilities.reminderRing
          || !window.seekmoreDesktop?.reminder?.ring
        ) {
          console.warn(
            '[TimeReminder] Desktop ring deferred because bridge is not ready',
            {
              notificationId: record.id,
              phase: desktopRuntime.phase,
              bridgeReady:
                desktopRuntime.bridgeReady,
              reminderRing:
                desktopRuntime.capabilities.reminderRing,
              apiAvailable: Boolean(
                window.seekmoreDesktop?.reminder?.ring,
              ),
            },
          );

          return false;
        }

        try {
          const result =
            await window.seekmoreDesktop.reminder.ring({
              notificationId: record.id,
              durationMs: RING_DURATION_MS,
            });

          if (!result.ok) {
            console.error(
              '[TimeReminder] Desktop ring rejected',
              {
                notificationId: record.id,
                errorCode: result.errorCode,
              },
            );

            return false;
          }
        } catch (reason) {
          console.error(
            '[TimeReminder] Desktop ring failed',
            {
              notificationId: record.id,
              reason,
            },
          );

          return false;
        }
      }

      activeRingingRef.current.add(record.id);

      setRingingIds(
        new Set(activeRingingRef.current),
      );

      const previousTimer =
        ringTimersRef.current.get(record.id);

      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer);
      }

      ringTimersRef.current.set(
        record.id,
        window.setTimeout(() => {
          void stopNotificationRing(record.id);
        }, RING_DURATION_MS),
      );

      return true;
    },
    [
      desktopRuntime.isDesktop,
      desktopRuntime.phase,
      desktopRuntime.bridgeReady,
      desktopRuntime.capabilities.reminderRing,
      stopNotificationRing,
    ],
  );

  useEffect(() => {
    let shouldOpen = false;

    for (const record of notifications) {
      const occurrenceKey = String(
        record.occurrenceKey ?? '',
      ).trim();

      if (
        !occurrenceKey
        || autoOpenedRef.current.has(occurrenceKey)
      ) {
        continue;
      }

      autoOpenedRef.current.add(occurrenceKey);
      shouldOpen = true;
    }

    if (!shouldOpen) {
      return;
    }

    persistAutoOpenedOccurrences(
      autoOpenedRef.current,
    );

    setPanelOpenRequested(true);
  }, [notifications]);

  useEffect(() => {
      
                   
                                              
       
    if (
      desktopRuntime.isDesktop
      && desktopRuntime.phase !== 'desktop-ready'
    ) {
      return;
    }

    for (const record of notifications) {
      const occurrenceKey = String(
        record.occurrenceKey ?? '',
      ).trim();

      if (
        !occurrenceKey
        || deliveredRef.current.has(occurrenceKey)
        || pendingDeliveryRef.current.has(occurrenceKey)
      ) {
        continue;
      }

      pendingDeliveryRef.current.add(occurrenceKey);

      void startNotificationRing(record)
        .then((started) => {
          if (!started) {
            return;
          }

          deliveredRef.current.add(occurrenceKey);

          persistDeliveredOccurrences(
            deliveredRef.current,
          );
        })
        .finally(() => {
          pendingDeliveryRef.current.delete(
            occurrenceKey,
          );
        });
    }
  }, [
    desktopRuntime.isDesktop,
    desktopRuntime.phase,
    notifications,
    startNotificationRing,
  ]);

  useEffect(() => {
    let disposed = false;

    const run = async (
      showLoading: boolean,
    ) => {
      if (disposed) {
        return;
      }

      await refresh(showLoading);
    };

    void run(true);

    const timer = window.setInterval(
      () => {
        void run(false);
      },
      POLL_INTERVAL_MS,
    );

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(
    () => () => {
      for (
        const timer of ringTimersRef.current.values()
      ) {
        window.clearTimeout(timer);
      }

      ringTimersRef.current.clear();

      const activeIds = [
        ...activeRingingRef.current,
      ];

      activeRingingRef.current.clear();
      pendingDeliveryRef.current.clear();

      for (const notificationId of activeIds) {
        if (
          window.seekmoreDesktop?.reminder?.stopRing
        ) {
          void window.seekmoreDesktop.reminder
            .stopRing({
              notificationId,
            })
            .catch(() => undefined);
        }
      }
    },
    [],
  );

  const consumePanelOpenRequest = useCallback(() => {
    setPanelOpenRequested(false);
  }, []);

  const performAction = useCallback(
    async (
      item: TimeItem,
      action: TimeItemAction,
      snoozeMs?: number,
    ) => {
      setActionId(item.id);

      try {
        await runTimeItemAction(
          item.id,
          action,
          {
            snoozeMs,
          },
        );

        await refresh(false);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : localize('time.operationFailed'),
        );
      } finally {
        setActionId(null);
      }
    },
    [refresh],
  );

  const acknowledge = useCallback(
    async (
      record: TimeNotificationRecord,
    ) => {
      try {
        await acknowledgeTimeNotification(
          record.id,
        );

        await stopNotificationRing(record.id);

        setNotifications((current) =>
          current.filter(
            (item) => item.id !== record.id,
          ),
        );

        setError(null);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : localize('time.notificationConfirmFailed'),
        );
      }
    },
    [stopNotificationRing],
  );

  const value =
    useMemo<TimeReminderContextValue>(
      () => ({
        items,
        notifications,
        activeCount,
        ringing: ringingIds.size > 0,
        panelOpenRequested,
        consumePanelOpenRequest,
        loading,
        actionId,
        error,
        refresh,
        performAction,
        acknowledge,
      }),
      [
        items,
        notifications,
        activeCount,
        ringingIds,
        panelOpenRequested,
        consumePanelOpenRequest,
        loading,
        actionId,
        error,
        refresh,
        performAction,
        acknowledge,
      ],
    );

  return (
    <TimeReminderContext.Provider
      value={value}
    >
      {children}
    </TimeReminderContext.Provider>
  );
}

function readAutoOpenedOccurrences(): Set<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(
        AUTO_OPENED_OCCURRENCES_KEY,
      ) ?? '[]',
    );

    return new Set(
      Array.isArray(parsed)
        ? parsed.map(String).filter(Boolean)
        : [],
    );
  } catch {
    return new Set();
  }
}

function persistAutoOpenedOccurrences(
  values: Set<string>,
): void {
  try {
    localStorage.setItem(
      AUTO_OPENED_OCCURRENCES_KEY,
      JSON.stringify(
        [...values].slice(-500),
      ),
    );
  } catch {
                                  
  }
}

function readDeliveredOccurrences(): Set<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(
        DELIVERED_OCCURRENCES_KEY,
      ) ?? '[]',
    );

    return new Set(
      Array.isArray(parsed)
        ? parsed.map(String).filter(Boolean)
        : [],
    );
  } catch {
    return new Set();
  }
}

function persistDeliveredOccurrences(
  values: Set<string>,
): void {
  try {
    localStorage.setItem(
      DELIVERED_OCCURRENCES_KEY,
      JSON.stringify(
        [...values].slice(-500),
      ),
    );
  } catch {
                                
  }
}