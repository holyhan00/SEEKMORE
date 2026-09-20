import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TimeStoreService } from './time-store.service';
import { REPEAT_UNIT_MS } from './time.service';
import type { TimeItem, TimeNotificationRecord } from './time.types';
import { formatLocalDateTime, normalizeTimeZone, parseDateTimeInZone } from './time-zone';

@Injectable()
export class TimeSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TimeSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly store: TimeStoreService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const userIds = await this.store.listUsers();
      for (const userId of userIds) await this.processUser(userId);
    } catch (error) {
      this.logger.error(`Time scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async processUser(userId: string): Promise<void> {
    const now = new Date();
    const snapshot = await this.store.read(userId);
    if (!snapshot.entries.some((item) => this.isDue(item, now))) return;
    await this.store.mutate(userId, (state) => {
      for (const item of state.entries) {
        if (!this.isDue(item, now)) continue;
        const occurrenceKey = `${item.id}:${item.triggerAt}`;
        if (!state.notifications.some((notification) => notification.occurrenceKey === occurrenceKey)) {
          state.notifications.push(this.notification(item, occurrenceKey, now));
        }
        item.lastTriggeredAt = now.toISOString();
        item.updatedAt = now.toISOString();
        if (item.repeat) this.advanceRepeated(item, now);
        else {
          item.status = 'triggered';
          if (item.kind === 'countdown') item.remainingMs = 0;
        }
      }
    });
  }

  private isDue(item: TimeItem, now: Date): boolean {
    if (!item.triggerAt) return false;
    if (item.kind === 'countdown' && item.status !== 'running') return false;
    if (item.kind !== 'countdown' && item.status !== 'scheduled') return false;
    const triggerAt = new Date(item.triggerAt).getTime();
    return Number.isFinite(triggerAt) && triggerAt <= now.getTime();
  }

  private notification(item: TimeItem, occurrenceKey: string, now: Date): TimeNotificationRecord {
    return {
      id: randomUUID(),
      userId: item.userId,
      itemId: item.id,
      conversationId: item.conversationId,
      kind: item.kind,
      title: item.title,
      body: item.note,
      occurrenceKey,
      triggeredAt: now.toISOString(),
      acknowledgedAt: null,
    };
  }

  private advanceRepeated(item: TimeItem, now: Date): void {
    if (!item.repeat || !item.triggerAt) return;

    const previousTrigger = new Date(item.triggerAt);
    const nextTrigger = this.nextRepeatedTrigger(item, previousTrigger, now);
    const shiftMs = nextTrigger.getTime() - previousTrigger.getTime();

    item.triggerAt = nextTrigger.toISOString();
    item.status = item.kind === 'countdown' ? 'running' : 'scheduled';

    if (item.kind === 'countdown') {
      const intervalMs = nextTrigger.getTime() - previousTrigger.getTime();
      item.durationMs = intervalMs;
      item.remainingMs = intervalMs;
      item.startedAt = now.toISOString();
    }

    if (item.startsAt) {
      item.startsAt = new Date(new Date(item.startsAt).getTime() + shiftMs).toISOString();
    }
    if (item.endsAt) {
      item.endsAt = new Date(new Date(item.endsAt).getTime() + shiftMs).toISOString();
    }
  }

  private nextRepeatedTrigger(item: TimeItem, previous: Date, now: Date): Date {
    if (!item.repeat) return previous;

    const timeZone = normalizeTimeZone(item.timezone);
    if ((item.repeat.unit === 'day' || item.repeat.unit === 'week') && timeZone) {
      const dayStep = item.repeat.every * (item.repeat.unit === 'week' ? 7 : 1);
      let local = formatLocalDateTime(previous, timeZone);

      for (let guard = 0; guard < 10_000; guard += 1) {
        const [datePart, timePart] = local.split('T');
        const [year, month, day] = datePart.split('-').map(Number);
        const shifted = new Date(Date.UTC(year, month - 1, day + dayStep));
        local = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}T${timePart}`;
        const next = parseDateTimeInZone(local, timeZone);
        if (next && next.getTime() > now.getTime()) return next;
      }
    }

    const intervalMs = item.repeat.every * REPEAT_UNIT_MS[item.repeat.unit];
    let next = previous.getTime() + intervalMs;
    while (next <= now.getTime()) next += intervalMs;
    return new Date(next);
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
