import { api } from '../../../lib/http';
import type { TimeItem, TimeItemsResponse, TimeNotificationsResponse, TimeSnapshotResponse } from './time.types';
import { getLocalizationSnapshot } from '../../../localization/LocalizationProvider';

export type TimeItemAction = 'pause' | 'resume' | 'stop' | 'complete' | 'cancel' | 'snooze';

export async function fetchTimeSnapshot(): Promise<TimeSnapshotResponse> {
  const response = await api.get<TimeSnapshotResponse>(
    '/time/snapshot',
    {
      params: {
        timezone: getLocalizationSnapshot().timeZone,
      },
    },
  );
  return response.data;
}

export async function fetchTimeItems(): Promise<TimeItemsResponse> {
  const response = await api.get<TimeItemsResponse>('/time/items', {
    params: {
      includeCompleted: false,
      limit: 50,
      timezone: getLocalizationSnapshot().timeZone,
    },
  });
  return response.data;
}

export async function fetchTimeNotifications(): Promise<TimeNotificationsResponse> {
  const response = await api.get<TimeNotificationsResponse>('/time/notifications', {
    params: { unreadOnly: true, limit: 50 },
  });
  return response.data;
}

export async function runTimeItemAction(
  itemId: string,
  action: TimeItemAction,
  options?: { snoozeMs?: number },
): Promise<TimeItem> {
  const response = await api.post<{ item: TimeItem }>(
    `/time/items/${encodeURIComponent(itemId)}/action`,
    { action, ...options },
  );
  return response.data.item;
}

export async function acknowledgeTimeNotification(notificationId: string): Promise<void> {
  await api.post(`/time/notifications/${encodeURIComponent(notificationId)}/ack`);
}
