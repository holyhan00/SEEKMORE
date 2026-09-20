export type TimeItemKind = 'alarm' | 'reminder' | 'event' | 'countdown' | 'stopwatch';
export type TimeItemStatus = 'scheduled' | 'running' | 'paused' | 'triggered' | 'completed' | 'cancelled';

export interface TimeItem {
  id: string;
  conversationId: string | null;
  kind: TimeItemKind;
  title: string;
  note: string | null;
  timezone: string;
  status: TimeItemStatus;
  triggerAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  durationMs: number | null;
  remainingMs: number | null;
  elapsedMs: number;
  liveElapsedMs: number;
  liveRemainingMs: number | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeNotificationRecord {
  id: string;
  itemId: string;
  conversationId: string | null;
  kind: TimeItemKind;
  title: string;
  body: string | null;
  occurrenceKey: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
}

export interface TimeItemsResponse {
  items: TimeItem[];
  activeCount: number;
  now: string;
  localNow: string;
  timezone: string;
  utcOffsetMinutes: number;
}

export interface TimeNotificationsResponse {
  notifications: TimeNotificationRecord[];
}

export interface TimeSnapshotResponse extends TimeItemsResponse {
  notifications: TimeNotificationRecord[];
}
