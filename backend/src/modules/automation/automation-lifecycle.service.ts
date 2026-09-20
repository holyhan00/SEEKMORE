import { BadRequestException, Injectable } from '@nestjs/common';
import type { AutomationDeliveryPolicy, AutomationStopPolicy, AutomationTrigger } from './automation.types';
import { formatLocalDateTime, normalizeTimeZone, parseDateTimeInZone } from '../../tools/time/time-zone';

const UNIT_MS: Record<'minute' | 'hour' | 'day' | 'week', number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

@Injectable()
export class AutomationLifecycleService {
  normalizeTrigger(value: unknown, now = new Date()): { trigger: AutomationTrigger; nextWakeAt: Date } {
    const input = record(value);
    const kind = text(input.kind);

    if (kind === 'once') {
      const timeZone = normalizeTimeZone(input.timeZone) ?? null;
      const runAt = this.futureTriggerDate(input.runAt, timeZone, 'AUTOMATION_RUN_AT_INVALID', now, false);
      return {
        trigger: { kind: 'once', runAt: runAt.toISOString(), timeZone },
        nextWakeAt: runAt,
      };
    }

    if (kind === 'interval') {
      const every = integer(input.every);
      const unit = text(input.unit) as keyof typeof UNIT_MS;
      if (!every || every < 1 || every > 10_000 || !UNIT_MS[unit]) {
        throw new BadRequestException('AUTOMATION_INTERVAL_INVALID');
      }
      const timeZone = normalizeTimeZone(input.timeZone) ?? null;
      const explicitRunAt = input.runAt == null || text(input.runAt) === ''
        ? null
        : this.futureTriggerDate(input.runAt, timeZone, 'AUTOMATION_RUN_AT_INVALID', now, true);
      const nextWakeAt = explicitRunAt ?? new Date(now.getTime() + every * UNIT_MS[unit]);
      return {
        trigger: {
          kind: 'interval',
          runAt: explicitRunAt?.toISOString() ?? null,
          every,
          unit,
          timeZone,
        },
        nextWakeAt,
      };
    }

    throw new BadRequestException('AUTOMATION_TRIGGER_INVALID');
  }

  normalizeDeliveryPolicy(value: unknown): AutomationDeliveryPolicy {
    const mode = text(record(value).mode);
    if (!mode) return { mode: 'always' };
    if (mode === 'always' || mode === 'on_completion') return { mode };
    throw new BadRequestException('AUTOMATION_DELIVERY_POLICY_INVALID');
  }

  normalizeStopPolicy(
    value: unknown,
    now = new Date(),
    applyDefaultLifetime = true,
  ): { stopPolicy: AutomationStopPolicy; expiresAt: Date | null } {
    const input = record(value);
    const indefinite = input.indefinite === true;
    const maxRuns = input.maxRuns == null ? null : integer(input.maxRuns);
    if (maxRuns !== null && (!maxRuns || maxRuns < 1 || maxRuns > 1_000_000)) {
      throw new BadRequestException('AUTOMATION_MAX_RUNS_INVALID');
    }

    const completionCondition = recordOrNull(input.completionCondition);
    let expiresAt = input.expiresAt == null || text(input.expiresAt) === ''
      ? null
      : this.futureDate(input.expiresAt, 'AUTOMATION_EXPIRES_AT_INVALID', now, false);

    if (indefinite && (expiresAt || maxRuns || completionCondition)) {
      throw new BadRequestException('AUTOMATION_INDEFINITE_STOP_CONFLICT');
    }

    if (applyDefaultLifetime && !expiresAt && !maxRuns && !completionCondition && !indefinite) {
      expiresAt = new Date(now.getTime() + this.defaultLifetimeDays() * 86_400_000);
    }

    return {
      stopPolicy: {
        expiresAt: expiresAt?.toISOString() ?? null,
        maxRuns,
        completionCondition,
        indefinite,
      },
      expiresAt,
    };
  }

  nextAfterRun(trigger: AutomationTrigger, scheduledFor: Date, now = new Date()): Date | null {
    if (trigger.kind === 'once') return null;
    if ((trigger.unit === 'day' || trigger.unit === 'week') && trigger.timeZone) {
      return this.nextWallClockOccurrence(trigger, scheduledFor, now);
    }
    const intervalMs = trigger.every * UNIT_MS[trigger.unit];
    let next = scheduledFor.getTime() + intervalMs;
    while (next <= now.getTime()) next += intervalMs;
    return new Date(next);
  }

  nextOnResume(trigger: AutomationTrigger, now = new Date()): Date {
    if (trigger.kind === 'once') {
      const configured = new Date(trigger.runAt);
      return configured.getTime() > now.getTime()
        ? configured
        : new Date(now.getTime() + 1_000);
    }
    const configured = trigger.runAt ? new Date(trigger.runAt) : null;
    if (configured && Number.isFinite(configured.getTime()) && configured.getTime() > now.getTime()) {
      return configured;
    }
    if ((trigger.unit === 'day' || trigger.unit === 'week') && trigger.timeZone && configured) {
      return this.nextWallClockOccurrence(trigger, configured, now);
    }
    return new Date(now.getTime() + trigger.every * UNIT_MS[trigger.unit]);
  }

  completionReason(input: {
    trigger: AutomationTrigger;
    stopPolicy: AutomationStopPolicy;
    runCount: number;
    expiresAt: Date | null;
    now?: Date;
  }): string | null {
    const now = input.now ?? new Date();
    if (input.trigger.kind === 'once') return 'ONCE_COMPLETED';
    if (input.stopPolicy.maxRuns && input.runCount >= input.stopPolicy.maxRuns) return 'MAX_RUNS_REACHED';
    if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
    return null;
  }

  shouldStopBeforeRun(expiresAt: Date | null, now = new Date()): boolean {
    return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
  }

  private defaultLifetimeDays(): number {
    const raw = Number(process.env.AUTOMATION_DEFAULT_LIFETIME_DAYS ?? 30);
    if (!Number.isFinite(raw)) return 30;
    return Math.max(1, Math.min(Math.floor(raw), 3650));
  }

  private nextWallClockOccurrence(
    trigger: Extract<AutomationTrigger, { kind: 'interval' }>,
    scheduledFor: Date,
    now: Date,
  ): Date {
    const timeZone = normalizeTimeZone(trigger.timeZone) ?? 'UTC';
    const dayStep = trigger.every * (trigger.unit === 'week' ? 7 : 1);
    let local = formatLocalDateTime(scheduledFor, timeZone);

    for (let guard = 0; guard < 10_000; guard += 1) {
      const [datePart, timePart] = local.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const shifted = new Date(Date.UTC(year, month - 1, day + dayStep));
      local = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}T${timePart}`;
      const next = parseDateTimeInZone(local, timeZone);
      if (next && next.getTime() > now.getTime()) return next;
    }

    throw new BadRequestException('AUTOMATION_INTERVAL_INVALID');
  }

  private futureTriggerDate(
    value: unknown,
    timeZone: string | null,
    code: string,
    now: Date,
    allowNow: boolean,
  ): Date {
    const raw = text(value);
    const hasExplicitOffset = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
    const date = !hasExplicitOffset && timeZone
      ? parseDateTimeInZone(raw, timeZone)
      : new Date(raw);
    if (!date || !Number.isFinite(date.getTime())) throw new BadRequestException(code);
    if (allowNow ? date.getTime() < now.getTime() : date.getTime() <= now.getTime()) {
      throw new BadRequestException(code);
    }
    return date;
  }

  private futureDate(value: unknown, code: string, now: Date, allowNow: boolean): Date {
    const date = new Date(text(value));
    if (!Number.isFinite(date.getTime())) throw new BadRequestException(code);
    if (allowNow ? date.getTime() < now.getTime() : date.getTime() <= now.getTime()) {
      throw new BadRequestException(code);
    }
    return date;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function recordOrNull(value: unknown): Record<string, unknown> | null {
  const output = record(value);
  return Object.keys(output).length ? output : null;
}
function text(value: unknown): string { return String(value ?? '').trim(); }
function integer(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function pad2(value: number): string { return String(value).padStart(2, '0'); }
