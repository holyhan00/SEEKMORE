export type TimeItemKind = 'alarm' | 'reminder' | 'event' | 'countdown' | 'stopwatch';

export type TimeItemStatus =
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'triggered'
  | 'completed'
  | 'cancelled';

export type TimeRepeatUnit = 'minute' | 'hour' | 'day' | 'week';

export interface TimeRepeatRule {
  every: number;
  unit: TimeRepeatUnit;
}

export interface TimeSourceRef {
  type: string;
  id: string;
}

export interface TimeItem {
  id: string;
  userId: string;
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
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  lastTriggeredAt: string | null;
  repeat: TimeRepeatRule | null;
  source: TimeSourceRef | null;
  idempotencyKey: string | null;
  laps: Array<{ id: string; label: string | null; elapsedMs: number; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface TimeNotificationRecord {
  id: string;
  userId: string;
  itemId: string;
  conversationId: string | null;
  kind: TimeItemKind;
  title: string;
  body: string | null;
  occurrenceKey: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
}

export interface TimeUserState {
  entries: TimeItem[];
  notifications: TimeNotificationRecord[];
}

export interface PresentedTimeItem extends TimeItem {
  liveElapsedMs: number;
  liveRemainingMs: number | null;
}
