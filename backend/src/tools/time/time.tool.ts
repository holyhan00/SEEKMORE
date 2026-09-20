import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { TimeService } from './time.service';

const ACTIONS = [
  'now',
  'alarm.create',
  'reminder.create',
  'calendar.create',
  'countdown.start',
  'stopwatch.start',
  'items.list',
  'item.get',
  'item.pause',
  'item.resume',
  'item.stop',
  'item.complete',
  'item.cancel',
  'item.snooze',
  'stopwatch.lap',
  'notifications.list',
  'notification.ack',
] as const;

@Injectable()
export class TimeTool implements Tool {
  name = 'time';
  version = '1.0.0';
  description = 'Create and manage alarms, reminders, scheduled events, countdowns, stopwatches, and their notifications. The user device timezone is synchronized automatically. For user-local wall-clock times, pass an ISO-8601 local date-time without an offset; the backend resolves it with the registered IANA timezone. An explicit UTC offset or Z remains authoritative. This is the only time-management tool; it does not provide calendar views or external calendar synchronization.';
  tags = ['time', 'alarm', 'reminder', 'event', 'countdown', 'stopwatch', 'notification'];
  timeoutMs = 10_000;
  maxOutputBytes = 256 * 1024;
  requiredSurfaces: NonNullable<Tool['requiredSurfaces']> = ['conversation'];
  parallelism: NonNullable<Tool['parallelism']> = 'resource_serial';
  supportsAbort = false;
  latencyClass: NonNullable<Tool['latencyClass']> = 'instant';

  inputSchema = {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ACTIONS },
      itemId: { type: 'string', minLength: 1, maxLength: 120 },
      notificationId: { type: 'string', minLength: 1, maxLength: 120 },
      title: { type: 'string', minLength: 1, maxLength: 240 },
      note: { type: 'string', maxLength: 2_000 },
      timezone: { type: 'string', maxLength: 100, description: 'Optional IANA timezone override such as Asia/Shanghai. Omit it to use the timezone synchronized from the user device.' },
      triggerAt: { type: 'string', description: 'ISO-8601 date-time. Use a local date-time without an offset for the user device timezone, or include an explicit offset/Z when the user names another timezone or absolute instant.' },
      startsAt: { type: 'string', description: 'ISO-8601 event start date-time. A value without an offset is interpreted in the synchronized user device timezone.' },
      endsAt: { type: 'string', description: 'Optional ISO-8601 event end date-time. A value without an offset is interpreted in the synchronized user device timezone.' },
      durationMs: { type: 'integer', minimum: 1, maximum: 31_536_000_000 },
      snoozeMs: { type: 'integer', minimum: 1, maximum: 31_536_000_000 },
      lapLabel: { type: 'string', maxLength: 120 },
      conversationId: { type: 'string', maxLength: 120 },
      sourceType: { type: 'string', maxLength: 80 },
      sourceId: { type: 'string', maxLength: 160 },
      repeat: {
        type: 'object',
        required: ['every', 'unit'],
        properties: {
          every: { type: 'integer', minimum: 1, maximum: 10_000 },
          unit: { type: 'string', enum: ['minute', 'hour', 'day', 'week'] },
        },
        additionalProperties: false,
      },
      includeCompleted: { type: 'boolean' },
      unreadOnly: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  };

  outputSchema = {
    type: 'object',
    additionalProperties: true,
  };

  constructor(private readonly time: TimeService) {}

  canExecute(ctx: ToolContext): boolean {
    return Boolean(ctx.userId && ctx.conversationId);
  }

  execute(args: Dict, ctx: ToolContext): Promise<unknown> {
    const action = typeof args.action === 'string' ? args.action.trim() : '';
    if (!action) throw new ToolError('TIME_ACTION_REQUIRED', 'action is required');
    return this.time.execute(action, args, ctx);
  }
}
