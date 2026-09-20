import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Dict, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { TimeStoreService } from './time-store.service';
import {
  formatLocalDateTime,
  getTimeZoneOffsetMinutes,
  normalizeTimeZone,
  parseDateTimeInZone,
} from './time-zone';
import type {
  PresentedTimeItem,
  TimeItem,
  TimeItemKind,
  TimeNotificationRecord,
  TimeRepeatRule,
  TimeRepeatUnit,
  TimeSourceRef,
  TimeUserState,
} from './time.types';

const ACTIVE_STATUSES = new Set(['scheduled', 'running', 'paused', 'triggered']);
const REPEAT_UNIT_MS: Record<TimeRepeatUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

@Injectable()
export class TimeService {
  constructor(private readonly store: TimeStoreService) {}

  async execute(action: string, args: Dict, ctx: ToolContext): Promise<unknown> {
    switch (action) {
      case 'now':
        return this.now(args, ctx);
      case 'alarm.create':
        return this.createScheduled('alarm', args, ctx);
      case 'reminder.create':
        return this.createScheduled('reminder', args, ctx);
      case 'calendar.create':
        return this.createEvent(args, ctx);
      case 'countdown.start':
        return this.startCountdown(args, ctx);
      case 'stopwatch.start':
        return this.startStopwatch(args, ctx);
      case 'items.list':
        return this.list(ctx.userId, {
          conversationId: this.optionalString(args.conversationId),
          includeCompleted: args.includeCompleted === true,
          limit: this.limit(args.limit, 100),
        });
      case 'item.get':
        return this.get(ctx.userId, this.requiredString(args.itemId, 'itemId'));
      case 'item.pause':
        return this.applyItemAction(ctx.userId, this.requiredString(args.itemId, 'itemId'), 'pause');
      case 'item.resume':
        return this.applyItemAction(ctx.userId, this.requiredString(args.itemId, 'itemId'), 'resume');
      case 'item.stop':
        return this.applyItemAction(ctx.userId, this.requiredString(args.itemId, 'itemId'), 'stop');
      case 'item.complete':
        return this.applyItemAction(ctx.userId, this.requiredString(args.itemId, 'itemId'), 'complete');
      case 'item.cancel':
        return this.applyItemAction(ctx.userId, this.requiredString(args.itemId, 'itemId'), 'cancel');
      case 'item.snooze':
        return this.applyItemAction(
          ctx.userId,
          this.requiredString(args.itemId, 'itemId'),
          'snooze',
          this.positiveInteger(args.snoozeMs, 'snoozeMs'),
        );
      case 'stopwatch.lap':
        return this.addLap(
          ctx.userId,
          this.requiredString(args.itemId, 'itemId'),
          this.optionalString(args.lapLabel),
        );
      case 'notifications.list':
        return this.listNotifications(ctx.userId, {
          unreadOnly: args.unreadOnly !== false,
          limit: this.limit(args.limit, 100),
        });
      case 'notification.ack':
        return this.acknowledgeNotification(
          ctx.userId,
          this.requiredString(args.notificationId, 'notificationId'),
        );
      default:
        throw new ToolError('TIME_ACTION_UNSUPPORTED', `Unsupported time action: ${action}`);
    }
  }

  async now(
    args: Dict = {},
    ctx?: ToolContext,
  ): Promise<{
    now: string;
    localNow: string;
    epochMs: number;
    timezone: string;
    utcOffsetMinutes: number;
  }> {
    const date = new Date();
    const timezone = ctx
      ? await this.resolveTimezone(args, ctx)
      : this.requireTimezone(
        this.optionalString(args.timezone) ?? 'UTC',
        'timezone',
      );

    return {
      now: date.toISOString(),
      localNow: formatLocalDateTime(date, timezone),
      epochMs: date.getTime(),
      timezone,
      utcOffsetMinutes: getTimeZoneOffsetMinutes(
        date,
        timezone,
      ),
    };
  }

  async snapshot(
    userId: string,
    requestedTimezone?: string | null,
  ): Promise<{
    items: PresentedTimeItem[];
    activeCount: number;
    notifications: TimeNotificationRecord[];
    now: string;
    localNow: string;
    timezone: string;
    utcOffsetMinutes: number;
  }> {
    const state = await this.store.read(userId);
    const now = new Date();
    const timezone = normalizeTimeZone(requestedTimezone) ?? 'UTC';
    const items = state.entries
      .filter((entry) => ACTIVE_STATUSES.has(entry.status))
      .sort((left, right) => this.sortValue(left) - this.sortValue(right))
      .slice(0, 50)
      .map((entry) => this.present(entry, now));
    const notifications = state.notifications
      .filter((notification) => !notification.acknowledgedAt)
      .sort((left, right) => right.triggeredAt.localeCompare(left.triggeredAt))
      .slice(0, 50);
    return {
      items,
      activeCount: state.entries.filter((entry) => ACTIVE_STATUSES.has(entry.status)).length,
      notifications,
      now: now.toISOString(),
      localNow: formatLocalDateTime(now, timezone),
      timezone,
      utcOffsetMinutes: getTimeZoneOffsetMinutes(
        now,
        timezone,
      ),
    };
  }

  async list(
    userId: string,
    options: {
      conversationId?: string | null;
      includeCompleted?: boolean;
      limit?: number;
      timezone?: string | null;
    } = {},
  ): Promise<{
    items: PresentedTimeItem[];
    activeCount: number;
    now: string;
    localNow: string;
    timezone: string;
    utcOffsetMinutes: number;
  }> {
    const state = await this.store.read(userId);
    const now = new Date();
    const timezone = normalizeTimeZone(options.timezone) ?? 'UTC';
    const items = state.entries
      .filter((entry) => !options.conversationId || entry.conversationId === options.conversationId)
      .filter((entry) => options.includeCompleted || ACTIVE_STATUSES.has(entry.status))
      .sort((left, right) => this.sortValue(left) - this.sortValue(right))
      .slice(0, options.limit ?? 100)
      .map((entry) => this.present(entry, now));
    return {
      items,
      activeCount: state.entries.filter((entry) => ACTIVE_STATUSES.has(entry.status)).length,
      now: now.toISOString(),
      localNow: formatLocalDateTime(now, timezone),
      timezone,
      utcOffsetMinutes: getTimeZoneOffsetMinutes(
        now,
        timezone,
      ),
    };
  }

  async get(userId: string, itemId: string): Promise<{ item: PresentedTimeItem }> {
    const state = await this.store.read(userId);
    const item = state.entries.find((entry) => entry.id === itemId);
    if (!item) throw new ToolError('TIME_ITEM_NOT_FOUND', 'Time item not found');
    return { item: this.present(item, new Date()) };
  }

  async listNotifications(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<{ notifications: TimeNotificationRecord[] }> {
    const state = await this.store.read(userId);
    const notifications = state.notifications
      .filter((notification) => !options.unreadOnly || !notification.acknowledgedAt)
      .sort((left, right) => right.triggeredAt.localeCompare(left.triggeredAt))
      .slice(0, options.limit ?? 100);
    return { notifications };
  }

  async acknowledgeNotification(
    userId: string,
    notificationId: string,
  ): Promise<{ notification: TimeNotificationRecord }> {
    return this.store.mutate(userId, (state) => {
      const notification = state.notifications.find((value) => value.id === notificationId);
      if (!notification) throw new ToolError('TIME_NOTIFICATION_NOT_FOUND', 'Time notification not found');
      notification.acknowledgedAt = notification.acknowledgedAt ?? new Date().toISOString();
      return { notification };
    });
  }

  async applyItemAction(
    userId: string,
    itemId: string,
    action: 'pause' | 'resume' | 'stop' | 'complete' | 'cancel' | 'snooze',
    snoozeMs?: number,
  ): Promise<{ item: PresentedTimeItem }> {
      
                           
                                                    
       
    const actionAt = new Date();
    const actionAtIso = actionAt.toISOString();
    const resolvedSnoozeMs = action === 'snooze'
      ? this.positiveInteger(snoozeMs ?? 300_000, 'snoozeMs')
      : null;

    const item = await this.store.mutate(userId, (state) => {
      const target = state.entries.find((entry) => entry.id === itemId);
      if (!target) throw new ToolError('TIME_ITEM_NOT_FOUND', 'Time item not found');

      if (action === 'pause') this.pause(target, actionAt);
      if (action === 'resume') this.resume(target, actionAt);
      if (action === 'stop') this.stop(target, actionAt);
      if (action === 'complete') {
        target.status = 'completed';
        target.completedAt = actionAtIso;
        this.acknowledgeItemNotifications(
          state.notifications,
          target.id,
          actionAtIso,
        );
      }
      if (action === 'cancel') {
        target.status = 'cancelled';
        target.completedAt = actionAtIso;
        this.acknowledgeItemNotifications(
          state.notifications,
          target.id,
          actionAtIso,
        );
      }
      if (action === 'snooze') {
        this.snooze(
          target,
          actionAt,
          resolvedSnoozeMs ?? 300_000,
        );
        this.acknowledgeItemNotifications(
          state.notifications,
          target.id,
          actionAtIso,
        );
      }

      target.updatedAt = actionAtIso;
      return target;
    });
    return { item: this.present(item, new Date()) };
  }

  async addLap(
    userId: string,
    itemId: string,
    label: string | null,
  ): Promise<{ item: PresentedTimeItem }> {
    const item = await this.store.mutate(userId, (state) => {
      const target = state.entries.find((entry) => entry.id === itemId);
      if (!target) throw new ToolError('TIME_ITEM_NOT_FOUND', 'Time item not found');
      if (target.kind !== 'stopwatch') throw new ToolError('TIME_ITEM_KIND_MISMATCH', 'Only a stopwatch can record laps');
      if (!['running', 'paused'].includes(target.status)) throw new ToolError('TIME_ITEM_NOT_ACTIVE', 'Stopwatch is not active');
      const now = new Date();
      target.laps.push({
        id: randomUUID(),
        label,
        elapsedMs: this.liveElapsed(target, now),
        createdAt: now.toISOString(),
      });
      target.updatedAt = now.toISOString();
      return target;
    });
    return { item: this.present(item, new Date()) };
  }

  private async createScheduled(
    kind: 'alarm' | 'reminder',
    args: Dict,
    ctx: ToolContext,
  ): Promise<{ item: PresentedTimeItem }> {
    const timezone = await this.resolveTimezone(args, ctx);
    const triggerAt = this.requiredFutureDate(
      args.triggerAt,
      'triggerAt',
      timezone,
    );
    const item = this.baseItem(
      kind,
      args,
      ctx,
      timezone,
      {
        status: 'scheduled',
        triggerAt: triggerAt.toISOString(),
      },
    );
    const stored = await this.storeNewItem(ctx.userId, item);
    return { item: this.present(stored, new Date()) };
  }

  private async createEvent(args: Dict, ctx: ToolContext): Promise<{ item: PresentedTimeItem }> {
    const timezone = await this.resolveTimezone(args, ctx);
    const startsAt = this.requiredDate(
      args.startsAt,
      'startsAt',
      timezone,
    );
    const endsAt = args.endsAt == null
      ? null
      : this.requiredDate(
        args.endsAt,
        'endsAt',
        timezone,
      );
    if (endsAt && endsAt.getTime() < startsAt.getTime()) {
      throw new ToolError('TIME_RANGE_INVALID', 'endsAt must be later than startsAt');
    }
    const triggerAt = args.triggerAt == null
      ? startsAt
      : this.requiredDate(
        args.triggerAt,
        'triggerAt',
        timezone,
      );
    if (triggerAt.getTime() <= Date.now()) {
      throw new ToolError('TIME_MUST_BE_FUTURE', 'event triggerAt must be in the future');
    }
    const item = this.baseItem(
      'event',
      args,
      ctx,
      timezone,
      {
        status: 'scheduled',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt?.toISOString() ?? null,
        triggerAt: triggerAt.toISOString(),
      },
    );
    const stored = await this.storeNewItem(ctx.userId, item);
    return { item: this.present(stored, new Date()) };
  }

  private async startCountdown(args: Dict, ctx: ToolContext): Promise<{ item: PresentedTimeItem }> {
    const timezone = await this.resolveTimezone(args, ctx);
    const durationMs = this.positiveInteger(args.durationMs, 'durationMs');
    const now = new Date();
    const item = this.baseItem(
      'countdown',
      args,
      ctx,
      timezone,
      {
        status: 'running',
        durationMs,
        remainingMs: durationMs,
        startedAt: now.toISOString(),
        triggerAt: new Date(now.getTime() + durationMs).toISOString(),
      },
    );
    const stored = await this.storeNewItem(ctx.userId, item);
    return { item: this.present(stored, now) };
  }

  private async startStopwatch(args: Dict, ctx: ToolContext): Promise<{ item: PresentedTimeItem }> {
    const timezone = await this.resolveTimezone(args, ctx);
    const now = new Date();
    const item = this.baseItem(
      'stopwatch',
      args,
      ctx,
      timezone,
      {
        title: this.optionalString(args.title) ?? '',
        status: 'running',
        startedAt: now.toISOString(),
      },
    );
    const stored = await this.storeNewItem(ctx.userId, item);
    return { item: this.present(stored, now) };
  }


  private async storeNewItem(userId: string, item: TimeItem): Promise<TimeItem> {
    return this.store.mutate(userId, (state) => {
      if (item.idempotencyKey) {
        const existing = state.entries.find((entry) => entry.idempotencyKey === item.idempotencyKey);
        if (existing) return existing;
      }
      state.entries.push(item);
      return item;
    });
  }

  private baseItem(
    kind: TimeItemKind,
    args: Dict,
    ctx: ToolContext,
    timezone: string,
    patch: Partial<TimeItem>,
  ): TimeItem {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      userId: ctx.userId,
      conversationId: this.optionalString(args.conversationId) ?? ctx.conversationId ?? null,
      kind,
      title: Object.prototype.hasOwnProperty.call(patch, 'title')
        ? String(patch.title ?? '').trim()
        : this.requiredString(args.title, 'title'),
      note: this.optionalString(args.note),
      timezone,
      status: 'scheduled',
      triggerAt: null,
      startsAt: null,
      endsAt: null,
      durationMs: null,
      remainingMs: null,
      elapsedMs: 0,
      startedAt: null,
      pausedAt: null,
      completedAt: null,
      lastTriggeredAt: null,
      repeat: this.repeat(args.repeat),
      source: this.source(args),
      idempotencyKey: this.optionalString(ctx.idempotencyKey),
      laps: [],
      createdAt: now,
      updatedAt: now,
      ...patch,
    };
  }


  private async resolveTimezone(
    args: Dict,
    ctx: ToolContext,
  ): Promise<string> {
    const explicitTimezone = this.optionalString(
      args.timezone,
    );

    if (explicitTimezone) {
      return this.requireTimezone(
        explicitTimezone,
        'timezone',
      );
    }

    const contextTimezone = this.optionalString(
      ctx.metadata?.timezone,
    );
    const normalizedContextTimezone = normalizeTimeZone(
      contextTimezone,
    );

    if (normalizedContextTimezone) {
      return normalizedContextTimezone;
    }

    return normalizeTimeZone(ctx.localization?.timeZone) ?? 'UTC';
  }

  private requireTimezone(
    value: string,
    field: string,
  ): string {
    const timezone = normalizeTimeZone(value);

    if (!timezone) {
      throw new ToolError(
        'TIME_TIMEZONE_INVALID',
        `${field} must be a valid IANA timezone`,
      );
    }

    return timezone;
  }

  private pause(item: TimeItem, now: Date): void {
    if (item.status === 'paused') return;
    if (item.kind === 'stopwatch') {
      if (item.status !== 'running') throw new ToolError('TIME_ITEM_NOT_RUNNING', 'Stopwatch is not running');
      item.elapsedMs = this.liveElapsed(item, now);
      item.startedAt = null;
      item.pausedAt = now.toISOString();
      item.status = 'paused';
      return;
    }
    if (item.kind === 'countdown') {
      if (item.status !== 'running') throw new ToolError('TIME_ITEM_NOT_RUNNING', 'Countdown is not running');
      item.remainingMs = Math.max(0, this.dateMs(item.triggerAt) - now.getTime());
      item.triggerAt = null;
      item.pausedAt = now.toISOString();
      item.status = 'paused';
      return;
    }
    if (item.status !== 'scheduled') throw new ToolError('TIME_ITEM_NOT_SCHEDULED', 'Time item is not scheduled');
    item.status = 'paused';
    item.pausedAt = now.toISOString();
  }

  private resume(item: TimeItem, now: Date): void {
    if (item.status !== 'paused') throw new ToolError('TIME_ITEM_NOT_PAUSED', 'Time item is not paused');
    if (item.kind === 'stopwatch') {
      item.startedAt = now.toISOString();
      item.pausedAt = null;
      item.status = 'running';
      return;
    }
    if (item.kind === 'countdown') {
      const remainingMs = Math.max(1, item.remainingMs ?? item.durationMs ?? 1);
      item.triggerAt = new Date(now.getTime() + remainingMs).toISOString();
      item.startedAt = now.toISOString();
      item.pausedAt = null;
      item.status = 'running';
      return;
    }
    item.pausedAt = null;
    item.status = 'scheduled';
  }

  private stop(item: TimeItem, now: Date): void {
    if (item.kind === 'stopwatch') {
      if (item.status === 'running') item.elapsedMs = this.liveElapsed(item, now);
      item.startedAt = null;
      item.status = 'completed';
      item.completedAt = now.toISOString();
      return;
    }
    if (item.kind === 'countdown') {
      item.remainingMs = item.status === 'running'
        ? Math.max(0, this.dateMs(item.triggerAt) - now.getTime())
        : item.remainingMs;
      item.triggerAt = null;
      item.status = 'completed';
      item.completedAt = now.toISOString();
      return;
    }
    item.status = 'completed';
    item.completedAt = now.toISOString();
  }

  private snooze(item: TimeItem, now: Date, snoozeMs: number): void {
    if (item.kind === 'stopwatch') throw new ToolError('TIME_ITEM_KIND_MISMATCH', 'A stopwatch cannot be snoozed');
    item.triggerAt = new Date(now.getTime() + snoozeMs).toISOString();
    item.remainingMs = item.kind === 'countdown' ? snoozeMs : item.remainingMs;
    item.startedAt = item.kind === 'countdown' ? now.toISOString() : item.startedAt;
    item.pausedAt = null;
    item.completedAt = null;
    item.status = item.kind === 'countdown' ? 'running' : 'scheduled';
  }

  private acknowledgeItemNotifications(
    notifications: TimeNotificationRecord[],
    itemId: string,
    acknowledgedAt: string,
  ): void {
    for (const notification of notifications) {
      if (
        notification.itemId === itemId
        && !notification.acknowledgedAt
      ) {
        notification.acknowledgedAt = acknowledgedAt;
      }
    }
  }

  private present(item: TimeItem, now: Date): PresentedTimeItem {
    return {
      ...item,
      liveElapsedMs: this.liveElapsed(item, now),
      liveRemainingMs: this.liveRemaining(item, now),
    };
  }

  private liveElapsed(item: TimeItem, now: Date): number {
    if (item.kind !== 'stopwatch') return item.elapsedMs;
    if (item.status !== 'running' || !item.startedAt) return item.elapsedMs;
    return Math.max(0, item.elapsedMs + now.getTime() - this.dateMs(item.startedAt));
  }

  private liveRemaining(item: TimeItem, now: Date): number | null {
    if (item.kind === 'stopwatch') return null;
    if (item.kind === 'countdown' && item.status === 'paused') return Math.max(0, item.remainingMs ?? 0);
    if (!item.triggerAt) return item.remainingMs;
    return Math.max(0, this.dateMs(item.triggerAt) - now.getTime());
  }

  private sortValue(item: TimeItem): number {
    if (item.triggerAt) return this.dateMs(item.triggerAt);
    if (item.status === 'running') return 0;
    return this.dateMs(item.updatedAt);
  }

  private repeat(value: unknown): TimeRepeatRule | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const every = Number(record.every);
    const unit = String(record.unit ?? '') as TimeRepeatUnit;
    if (!Number.isInteger(every) || every < 1 || every > 10_000 || !(unit in REPEAT_UNIT_MS)) {
      throw new ToolError('TIME_REPEAT_INVALID', 'repeat requires a positive integer every and unit minute, hour, day, or week');
    }
    return { every, unit };
  }

  private source(args: Dict): TimeSourceRef | null {
    const type = this.optionalString(args.sourceType);
    const id = this.optionalString(args.sourceId);
    if (!type && !id) return null;
    if (!type || !id) throw new ToolError('TIME_SOURCE_INVALID', 'sourceType and sourceId must be supplied together');
    return { type, id };
  }

  private requiredFutureDate(
    value: unknown,
    field: string,
    timezone: string,
  ): Date {
    const date = this.requiredDate(
      value,
      field,
      timezone,
    );
    if (date.getTime() <= Date.now()) throw new ToolError('TIME_MUST_BE_FUTURE', `${field} must be in the future`);
    return date;
  }

  private requiredDate(
    value: unknown,
    field: string,
    timezone: string,
  ): Date {
    const text = this.requiredString(value, field);
    const date = parseDateTimeInZone(text, timezone);
    if (!date) {
      throw new ToolError(
        'TIME_DATE_INVALID',
        `${field} must be a valid ISO-8601 date-time in ${timezone}`,
      );
    }
    return date;
  }

  private requiredString(value: unknown, field: string): string {
    const text = this.optionalString(value);
    if (!text) throw new ToolError('TIME_ARGUMENT_REQUIRED', `${field} is required`);
    return text;
  }

  private optionalString(value: unknown): string | null {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
  }

  private positiveInteger(value: unknown, field: string): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) throw new ToolError('TIME_NUMBER_INVALID', `${field} must be greater than zero`);
    return Math.floor(numeric);
  }

  private limit(value: unknown, max: number): number {
    const numeric = Number(value ?? 30);
    return Number.isFinite(numeric) ? Math.max(1, Math.min(Math.floor(numeric), max)) : 30;
  }

  private dateMs(value: string | null): number {
    if (!value) return 0;
    const numeric = new Date(value).getTime();
    return Number.isFinite(numeric) ? numeric : 0;
  }
}

export { REPEAT_UNIT_MS };
