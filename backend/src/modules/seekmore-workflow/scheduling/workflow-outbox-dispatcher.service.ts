import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { WorkflowRunRepository } from '../persistence/workflow-run.repository';
import {
  WORKFLOW_SCHEDULER,
  type WorkflowScheduleReason,
  type WorkflowSchedulerPort,
} from './workflow-scheduler.port';

@Injectable()
export class WorkflowOutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowOutboxDispatcherService.name);
  private readonly workerId = `workflow-outbox:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: WorkflowRunRepository,
    @Inject(WORKFLOW_SCHEDULER) private readonly scheduler: WorkflowSchedulerPort,
  ) {}

  onModuleInit(): void {
    const intervalMs = Math.max(500, Number(process.env.WORKFLOW_OUTBOX_INTERVAL_MS ?? 1_500));
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.claim(50);
      for (const row of rows) await this.deliver(row);
    } finally {
      this.running = false;
    }
  }

  private claim(limit: number): Promise<any[]> {
    const expiresAt = new Date(Date.now() + 30_000);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw(Prisma.sql`
        SELECT *
        FROM "runtime_event_outbox"
        WHERE "aggregate_type" = 'seekmore_workflow'
          AND "available_at" <= NOW()
          AND (
            "status" = 'pending'
            OR ("status" = 'claimed' AND "claim_expires_at" < NOW())
          )
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `) as any[];
      if (!rows.length) return [];
      await tx.runtimeEventOutbox.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
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
      const eventType = String(row.event_type ?? row.eventType ?? '');
      const payload = this.record(row.payload_json ?? row.payloadJson);
      const reason = this.reason(eventType, payload);
      const run = await this.runs.findById(String(row.aggregate_id ?? row.aggregateId));
      const requestedPhaseId = this.stringOrNull(payload.phaseId);
      if (
        run
        && reason
        && requestedPhaseId
        && run.status === 'RUNNING'
        && run.currentPhaseId === requestedPhaseId
        && (reason === 'user_resume' || run.continuationMode === 'AUTO')
      ) {
        await this.scheduler.enqueue({
          workflowId: run.id,
          phaseId: requestedPhaseId,
          requestedAt: this.dateText(row.created_at ?? row.createdAt),
          reason,
          sourceTraceId: this.stringOrNull(payload.sourceTraceId),
          expectedWorkflowVersion: this.numberOrNull(payload.expectedWorkflowVersion),
        });
      }
      await (this.prisma as any).runtimeEventOutbox.update({
        where: { id: row.id },
        data: {
          status: 'delivered',
          deliveredAt: new Date(),
          claimedBy: null,
          claimExpiresAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const attempts = Number(row.attempts ?? 0) + 1;
      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
      await (this.prisma as any).runtimeEventOutbox.update({
        where: { id: row.id },
        data: {
          status: 'pending',
          availableAt: new Date(Date.now() + delayMs),
          claimedBy: null,
          claimExpiresAt: null,
          lastError: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
      this.logger.warn(`workflow_outbox_delivery_failed id=${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private reason(
    eventType: string,
    payload: Record<string, unknown>,
  ): WorkflowScheduleReason | null {
    if (eventType !== 'workflow.turn.requested') return null;
    const reason = this.stringOrNull(payload.reason);
    return reason === 'user_resume' ? 'user_resume' : 'auto_continue';
  }

  private dateText(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value ?? ''));
    return Number.isFinite(date.getTime())
      ? date.toISOString()
      : new Date().toISOString();
  }

  private record(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
      } catch {
        return {};
      }
    }
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private numberOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
