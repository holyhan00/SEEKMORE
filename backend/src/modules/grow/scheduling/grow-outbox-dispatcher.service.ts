import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { GrowOrchestratorService } from '../core/grow-orchestrator.service';
import type { GrowPolicy } from '../core/grow-policy';
import type { GrowTerminalEvent, GrowTerminalStatus } from '../domain/grow.types';
import { isGrowSyntheticTrace } from '../domain/grow-synthetic-run.util';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import { GrowSkillUsageSettlementService } from '../infrastructure/usage/grow-skill-usage-settlement.service';
import { GROW_LOGGER, GROW_POLICY } from '../nest/grow.tokens';

@Injectable()
export class GrowOutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId = `grow-outbox:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: GrowOrchestratorService,
    private readonly settlement: GrowSkillUsageSettlementService,
    @Inject(GROW_POLICY) private readonly policy: GrowPolicy,
    @Inject(GROW_LOGGER) private readonly logger: GrowLoggerPort,
  ) {}

  onModuleInit(): void {
    if (!this.policy.enabled) return;
    const intervalMs = Math.max(500, Number(process.env.GROW_OUTBOX_INTERVAL_MS ?? 1_500));
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.tick();
    this.logger.log({ level: 'info', event: 'grow.outbox.started', message: 'Grow terminal-event dispatcher started.', fields: { workerId: this.workerId, intervalMs } });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running || !this.policy.enabled) return;
    this.running = true;
    try {
      const rows = await this.claim(25);
      for (const row of rows) await this.deliver(row);
    } finally {
      this.running = false;
    }
  }

  private claim(limit: number): Promise<any[]> {
    const expiresAt = new Date(Date.now() + 30_000);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw(Prisma.sql`
        SELECT * FROM "runtime_event_outbox"
        WHERE "aggregate_type" = 'agent_turn'
          AND "event_type" = 'agent.turn.terminal'
          AND "available_at" <= NOW()
          AND ("status" = 'pending' OR ("status" = 'claimed' AND "claim_expires_at" < NOW()))
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `) as any[];
      if (!rows.length) return [];
      await tx.runtimeEventOutbox.updateMany({
        where: { id: { in: rows.map((row) => String(row.id)) } },
        data: {
          status: 'claimed',
          claimedBy: this.workerId,
          claimExpiresAt: expiresAt,
          attempts: { increment: 1 },
        },
      });
      return rows;
    });
  }

  private async deliver(row: any): Promise<void> {
    try {
      const event = this.event(row);
      if (isGrowSyntheticTrace(event.traceId)) {
        await this.prisma.runtimeEventOutbox.update({
          where: { id: String(row.id) },
          data: {
            status: 'delivered',
            deliveredAt: new Date(),
            claimedBy: null,
            claimExpiresAt: null,
            lastError: null,
          },
        });
        this.logger.log({
          level: 'debug',
          event: 'grow.outbox.synthetic_turn_skipped',
          message: 'Ignored terminal event emitted by detached GROW_FOCUS.',
          fields: {
            eventId: event.eventId,
            turnId: event.turnId,
            traceId: event.traceId,
          },
        });
        return;
      }
      await this.settlement.settle(event);
      const reviewId = await this.orchestrator.observeOnly(event);
      await this.prisma.runtimeEventOutbox.update({
        where: { id: String(row.id) },
        data: {
          status: 'delivered', deliveredAt: new Date(), claimedBy: null,
          claimExpiresAt: null, lastError: null,
        },
      });
      this.logger.log({
        level: 'info', event: 'grow.outbox.delivered',
        message: 'Grow consumed terminal Agent event.',
        fields: { eventId: event.eventId, turnId: event.turnId, reviewId },
      });
    } catch (error) {
      const attempts = Number(row.attempts ?? 0) + 1;
      const dead = attempts >= 5;
      await this.prisma.runtimeEventOutbox.update({
        where: { id: String(row.id) },
        data: {
          status: dead ? 'dead' : 'pending',
          availableAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))),
          claimedBy: null,
          claimExpiresAt: null,
          lastError: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
      this.logger.log({
        level: 'error', event: dead ? 'grow.outbox.dead' : 'grow.outbox.retry',
        message: 'Grow terminal-event delivery failed.',
        fields: { outboxId: row.id, attempts, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private event(row: any): GrowTerminalEvent {
    const payload = this.record(row.payload_json ?? row.payloadJson);
    return {
      eventId: String(row.event_id ?? row.eventId),
      eventType: 'agent.turn.terminal',
      turnId: this.required(payload.turnId, 'turnId'),
      traceId: this.required(payload.traceId, 'traceId'),
      userId: this.required(payload.userId, 'userId'),
      agentId: this.required(payload.agentId, 'agentId'),
      conversationId: this.required(payload.conversationId, 'conversationId'),
      status: this.status(payload.status),
      occurredAt: String(payload.occurredAt ?? new Date().toISOString()),
    };
  }

  private status(value: unknown): GrowTerminalStatus {
    const status = String(value ?? '').replace(/^waiting_/, '');
    if (status === 'succeeded' || status === 'partial' || status === 'failed' || status === 'blocked' || status === 'cancelled') return status;
    return 'failed';
  }

  private required(value: unknown, field: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new Error(`GROW_OUTBOX_${field.toUpperCase()}_MISSING`);
    return text;
  }

  private record(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }
}
