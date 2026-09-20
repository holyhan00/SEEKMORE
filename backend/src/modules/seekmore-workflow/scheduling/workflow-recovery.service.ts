import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { WorkflowEventRepository, type WorkflowPersistedEvent } from '../persistence/workflow-event.repository';
import { WorkflowPhaseRepository } from '../persistence/workflow-phase.repository';
import { WorkflowRunRepository } from '../persistence/workflow-run.repository';
import { WorkflowTurnLinkRepository } from '../persistence/workflow-turn-link.repository';
import { WorkflowAutoTurnService } from './workflow-auto-turn.service';
import { WorkflowLeaseService } from './workflow-lease.service';
import {
  WORKFLOW_SCHEDULER,
  type WorkflowScheduleReason,
  type WorkflowScheduleRequest,
  type WorkflowSchedulerPort,
} from './workflow-scheduler.port';

@Injectable()
export class WorkflowRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowRecoveryService.name);
  private timer: NodeJS.Timeout | null = null;
  private unsubscribeScheduler: (() => void) | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: WorkflowRunRepository,
    private readonly phases: WorkflowPhaseRepository,
    private readonly turnLinks: WorkflowTurnLinkRepository,
    private readonly events: WorkflowEventRepository,
    private readonly leases: WorkflowLeaseService,
    private readonly autoTurns: WorkflowAutoTurnService,
    @Inject(WORKFLOW_SCHEDULER) private readonly scheduler: WorkflowSchedulerPort,
  ) {}

  onModuleInit(): void {
    const intervalMs = Math.max(2_000, Number(process.env.WORKFLOW_RECOVERY_INTERVAL_MS ?? 5_000));
    this.unsubscribeScheduler = this.scheduler.subscribe((request) => this.dispatchRequest(request));
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribeScheduler?.();
    this.unsubscribeScheduler = null;
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const requests = await this.events.listRecentTurnRequests(100);
      for (const event of requests) {
        await this.recoverExplicitRequest(event);
      }
    } catch (error) {
      this.logger.warn(`workflow_recovery_tick_failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async recoverExplicitRequest(event: WorkflowPersistedEvent): Promise<void> {
    const run = await this.runs.findById(event.workflowId);
    const phaseId = event.phaseId;
    const reason = this.requestReason(event.payload.reason);
    const sourceTraceId = this.stringOrNull(event.payload.sourceTraceId);
    const expectedWorkflowVersion = this.numberOrNull(event.payload.expectedWorkflowVersion);

    if (!run || !phaseId || !reason) return;
    if (run.status !== 'RUNNING' || run.currentPhaseId !== phaseId) return;
    if (reason !== 'user_resume' && run.continuationMode !== 'AUTO') return;
    if (expectedWorkflowVersion != null && run.version !== expectedWorkflowVersion) return;
    if (await this.hasUserTurnActivity(run.conversationId)) return;

    const latest = await this.turnLinks.findLatestByWorkflow(run.id);
    if (
      latest
      && latest.traceId !== sourceTraceId
      && latest.createdAt.getTime() >= event.createdAt.getTime()
    ) {
      return;
    }
    if (sourceTraceId && await this.sourceTurnStillRunning(sourceTraceId)) return;

    await this.scheduler.enqueue({
      workflowId: run.id,
      phaseId,
      requestedAt: event.createdAt.toISOString(),
      reason,
      sourceTraceId,
      expectedWorkflowVersion,
    });
  }

  private async dispatchRequest(request: WorkflowScheduleRequest): Promise<void> {
    const requestedAt = new Date(request.requestedAt).getTime();
    const latestLink = await this.turnLinks.findLatestByWorkflow(request.workflowId);
    if (
      request.sourceTraceId
      && latestLink
      && latestLink.traceId !== request.sourceTraceId
      && Number.isFinite(requestedAt)
      && latestLink.createdAt.getTime() >= requestedAt
    ) {
      return;
    }

    if (request.sourceTraceId && await this.sourceTurnStillRunning(request.sourceTraceId)) {
      this.defer(request);
      return;
    }

    if (await this.hasUserTurnActivityByWorkflow(request.workflowId)) return;

    const run = await this.runs.findById(request.workflowId);
    if (!run || run.status !== 'RUNNING' || !run.currentPhaseId) return;
    if (request.expectedWorkflowVersion != null && run.version !== request.expectedWorkflowVersion) return;
    if (run.currentPhaseId !== request.phaseId) return;
    if (request.reason !== 'user_resume' && run.continuationMode !== 'AUTO') return;
    const phase = await this.phases.findById(request.phaseId);
    if (!phase || phase.workflowId !== run.id || phase.status !== 'ACTIVE') return;

    try {
      await this.leases.withLease(run.id, async () => {
        const latestRun = await this.runs.findById(run.id);
        if (!latestRun || latestRun.status !== 'RUNNING' || latestRun.currentPhaseId !== phase.id) return;
        if (request.expectedWorkflowVersion != null && latestRun.version !== request.expectedWorkflowVersion) return;
        if (await this.hasUserTurnActivity(latestRun.conversationId)) return;
        await this.autoTurns.execute(latestRun, phase, request.reason);
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code !== 'WORKFLOW_LEASE_CONFLICT') {
        this.logger.warn(`workflow_schedule_dispatch_failed id=${run.id}: ${code}`);
      }
    }
  }

  private async sourceTurnStillRunning(traceId: string): Promise<boolean> {
    const turn = await this.prisma.agentTurn.findUnique({
      where: { traceId },
      select: { status: true },
    });
    return turn?.status === 'running';
  }


  private async hasUserTurnActivityByWorkflow(workflowId: string): Promise<boolean> {
    const run = await this.runs.findById(workflowId);
    return run ? this.hasUserTurnActivity(run.conversationId) : false;
  }

  private async hasUserTurnActivity(conversationId: string): Promise<boolean> {
    const row = await this.prisma.chatTurnRequest.findFirst({
      where: {
        conversationId,
        status: {
          in: [
            'QUEUED',
            'STARTING',
            'RUNNING',
            'WAITING_APPROVAL',
            'WAITING_EXTERNAL',
            'CANCELLING',
          ],
        },
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  private numberOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  private defer(request: WorkflowScheduleRequest): void {
    const timer = setTimeout(() => void this.scheduler.enqueue(request), 300);
    timer.unref?.();
  }

  private requestReason(value: unknown): WorkflowScheduleReason | null {
    const reason = String(value ?? '').trim();
    return reason === 'auto_continue' || reason === 'user_resume'
      ? reason
      : null;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
