import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../tools/toolstypes';
import { ToolError } from '../../tools/toolstypes';
import { AutomationService } from './automation.service';
import type { AutomationDeliveryPolicy, AutomationStopPolicy, AutomationTrigger } from './automation.types';

const ACTIONS = ['create', 'list', 'get', 'update', 'pause', 'resume', 'cancel', 'complete'] as const;

@Injectable()
export class AutomationTool implements Tool {
  name = 'automation';
  version = '1.0.0';
  description = 'Create and manage future autonomous tasks that wake up later, run independently, and report results back to the original conversation as normal assistant messages. Use this for repeated checks, future monitoring, scheduled autonomous work, or condition-based watches. Every task must have a finite stop policy unless the user explicitly requests indefinite monitoring. Set deliveryPolicy.mode=on_completion only when the user explicitly wants notification only after the completion condition is met; otherwise use always. If no stop rule is specified, the system automatically applies its default finite lifetime. Do not use this tool for simple alarms or reminders that do not require the agent to do work; use the time tool for those.';
  tags = ['automation', 'schedule', 'monitor', 'background', 'recurring'];
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
      automationId: { type: 'string', minLength: 1, maxLength: 120 },
      title: { type: 'string', minLength: 1, maxLength: 240 },
      instruction: { type: 'string', minLength: 1, maxLength: 20_000 },
      status: { type: 'string', maxLength: 80, description: 'Comma-separated statuses for list, e.g. ACTIVE,PAUSED.' },
      trigger: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['once', 'interval'] },
          runAt: { type: ['string', 'null'], description: 'ISO-8601 first/only run time. For interval tasks it may be omitted to start after one interval.' },
          every: { type: 'integer', minimum: 1, maximum: 10_000 },
          unit: { type: 'string', enum: ['minute', 'hour', 'day', 'week'] },
          timeZone: { type: ['string', 'null'], description: 'IANA time zone for recurring day/week wall-clock scheduling. Defaults to the current runtime time zone.' },
        },
        additionalProperties: false,
      },
      deliveryPolicy: {
        type: ['object', 'null'],
        properties: {
          mode: { type: 'string', enum: ['always', 'on_completion'], description: 'Use always by default. Use on_completion only when the user explicitly wants to be told only after the completion condition is met.' },
        },
        additionalProperties: false,
      },
      stopPolicy: {
        type: ['object', 'null'],
        properties: {
          expiresAt: { type: ['string', 'null'], description: 'ISO-8601 responsibility end time.' },
          maxRuns: { type: ['integer', 'null'], minimum: 1, maximum: 1_000_000 },
          completionCondition: { type: ['object', 'null'], additionalProperties: true },
          indefinite: { type: 'boolean', description: 'Set true only when the user explicitly asks to keep running until manually stopped.' },
        },
        additionalProperties: false,
      },
      reason: { type: 'string', maxLength: 240 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  };

  outputSchema = { type: 'object', additionalProperties: true };

  constructor(private readonly automations: AutomationService) {}

  canExecute(ctx: ToolContext): boolean {
    return Boolean(ctx.userId && ctx.conversationId);
  }

  async execute(args: Dict, ctx: ToolContext): Promise<unknown> {
    const action = text(args.action);
    if (!action) throw new ToolError('AUTOMATION_ACTION_REQUIRED', 'action is required');

    if (action === 'create') {
      return {
        automation: await this.automations.create({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          anchorMessageId: ctx.assistantMessageId ?? null,
          title: text(args.title),
          instruction: text(args.instruction),
          trigger: this.withRuntimeTimeZone(args.trigger, ctx),
          stopPolicy: args.stopPolicy as unknown as AutomationStopPolicy,
          deliveryPolicy: args.deliveryPolicy as unknown as AutomationDeliveryPolicy,
        }),
      };
    }

    if (action === 'list') {
      return {
        items: await this.automations.list({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          statuses: text(args.status) ? text(args.status).split(',') : null,
          limit: number(args.limit, 100),
        }),
      };
    }

    const automationId = text(args.automationId);
    if (!automationId && action !== 'complete') {
      throw new ToolError('AUTOMATION_ID_REQUIRED', 'automationId is required');
    }

    switch (action) {
      case 'get': return { automation: await this.automations.get(ctx.userId, automationId) };
      case 'update': return { automation: await this.automations.update(ctx.userId, automationId, {
        ...(args.title !== undefined ? { title: text(args.title) } : {}),
        ...(args.instruction !== undefined ? { instruction: text(args.instruction) } : {}),
        ...(args.trigger !== undefined ? { trigger: this.withRuntimeTimeZone(args.trigger, ctx) } : {}),
        ...(args.stopPolicy !== undefined ? { stopPolicy: args.stopPolicy as unknown as AutomationStopPolicy } : {}),
        ...(args.deliveryPolicy !== undefined ? { deliveryPolicy: args.deliveryPolicy as unknown as AutomationDeliveryPolicy } : {}),
      }) };
      case 'pause': return { automation: await this.automations.pause(ctx.userId, automationId) };
      case 'resume': return { automation: await this.automations.resume(ctx.userId, automationId) };
      case 'cancel': return { automation: await this.automations.cancel(ctx.userId, automationId, 'AGENT', text(args.reason) || 'agent_cancelled') };
      case 'complete': {
        const traceId = text(ctx.traceId);
        if (!traceId) throw new ToolError('AUTOMATION_TRACE_REQUIRED', 'complete is only valid inside an automation run');
        return { automation: await this.automations.completeFromTrace(ctx.userId, traceId, text(args.reason) || 'CONDITION_MET') };
      }
      default: throw new ToolError('AUTOMATION_ACTION_UNSUPPORTED', `Unsupported action: ${action}`);
    }
  }

  private withRuntimeTimeZone(value: unknown, ctx: ToolContext): AutomationTrigger {
    const trigger = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
    if ((trigger.kind === 'interval' || trigger.kind === 'once') && !text(trigger.timeZone)) {
      trigger.timeZone = ctx.localization?.timeZone ?? null;
    }
    return trigger as unknown as AutomationTrigger;
  }
}

function text(value: unknown): string { return String(value ?? '').trim(); }
function number(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(Math.floor(n), 200)) : fallback;
}
