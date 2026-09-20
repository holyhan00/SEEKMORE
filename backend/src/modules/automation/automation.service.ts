import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Automation, type AutomationRun } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AutomationControlBus } from './automation-control.bus';
import { AutomationLifecycleService } from './automation-lifecycle.service';
import { AutomationRealtimeBus } from './automation-realtime.bus';
import type {
  AutomationCancelActor,
  AutomationDeliveryPolicy,
  AutomationCleanupResult,
  AutomationCreateInput,
  AutomationSnapshot,
  AutomationStopPolicy,
  AutomationTrigger,
  AutomationUpdateInput,
} from './automation.types';

const OPEN_RUN_STATUSES = ['PENDING', 'RUNNING', 'CANCELLING'] as const;
const ACTIVE_AUTOMATION_STATUSES = ['ACTIVE', 'PAUSED'] as const;

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: AutomationLifecycleService,
    private readonly realtime: AutomationRealtimeBus,
    private readonly control: AutomationControlBus,
  ) {}

  async create(input: AutomationCreateInput): Promise<AutomationSnapshot> {
    const title = cleanText(input.title, 240);
    const instruction = cleanText(input.instruction, 20_000);
    if (!title) throw new BadRequestException('AUTOMATION_TITLE_REQUIRED');
    if (!instruction) throw new BadRequestException('AUTOMATION_INSTRUCTION_REQUIRED');

    const now = new Date();
    const { trigger, nextWakeAt } = this.lifecycle.normalizeTrigger(input.trigger, now);
    const { stopPolicy, expiresAt } = this.lifecycle.normalizeStopPolicy(
      input.stopPolicy,
      now,
      trigger.kind !== 'once',
    );
    const deliveryPolicy = this.lifecycle.normalizeDeliveryPolicy(input.deliveryPolicy);
    if (deliveryPolicy.mode === 'on_completion' && !stopPolicy.completionCondition) {
      throw new BadRequestException('AUTOMATION_COMPLETION_DELIVERY_REQUIRES_CONDITION');
    }
    if (expiresAt && nextWakeAt.getTime() >= expiresAt.getTime()) {
      throw new BadRequestException('AUTOMATION_FIRST_RUN_AFTER_EXPIRY');
    }

    const automation = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: {
          id: input.conversationId,
          userId: input.userId,
          deletedAt: null,
        },
        select: { id: true, agentId: true },
      });
      if (!conversation) throw new NotFoundException('AUTOMATION_CONVERSATION_NOT_FOUND');

      if (input.anchorMessageId) {
        const anchor = await tx.message.findFirst({
          where: {
            id: input.anchorMessageId,
            conversationId: input.conversationId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!anchor) throw new BadRequestException('AUTOMATION_ANCHOR_MESSAGE_INVALID');
      }

      return tx.automation.create({
        data: {
          userId: input.userId,
          agentId: conversation.agentId,
          conversationId: input.conversationId,
          anchorMessageId: input.anchorMessageId ?? null,
          title,
          instruction,
          trigger: trigger as unknown as Prisma.InputJsonValue,
          stopPolicy: stopPolicy as unknown as Prisma.InputJsonValue,
          deliveryPolicy: deliveryPolicy as unknown as Prisma.InputJsonValue,
          status: 'ACTIVE',
          nextWakeAt,
          expiresAt,
        },
      });
    });

    const snapshot = this.snapshot(automation);
    this.realtime.changed(snapshot);
    return snapshot;
  }

  async list(input: {
    userId: string;
    conversationId?: string | null;
    anchorMessageId?: string | null;
    statuses?: string[] | null;
    limit?: number;
  }): Promise<AutomationSnapshot[]> {
    if (input.conversationId) await this.assertConversationAccess(input.userId, input.conversationId);
    const statuses = (input.statuses ?? [])
      .map((value) => String(value ?? '').trim().toUpperCase())
      .filter((value) => ['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'].includes(value));
    const rows = await this.prisma.automation.findMany({
      where: {
        userId: input.userId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.anchorMessageId ? { anchorMessageId: input.anchorMessageId } : {}),
        ...(statuses.length ? { status: { in: statuses as any } } : {}),
        OR: [
          { cancelReason: null },
          { cancelReason: { not: 'conversation_deleted' } },
        ],
        conversation: { deletedAt: null },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: Math.max(1, Math.min(input.limit ?? 100, 200)),
    });
    return rows.map((row) => this.snapshot(row));
  }

  async get(userId: string, automationId: string): Promise<AutomationSnapshot> {
    return this.snapshot(await this.owned(userId, automationId));
  }

  async update(userId: string, automationId: string, input: AutomationUpdateInput): Promise<AutomationSnapshot> {
    const current = await this.owned(userId, automationId);
    if (current.status === 'CANCELLED' || current.status === 'COMPLETED') {
      throw new BadRequestException('AUTOMATION_TERMINAL');
    }

    const now = new Date();
    const data: Prisma.AutomationUpdateInput = {};
    if (input.title !== undefined) {
      const title = cleanText(input.title, 240);
      if (!title) throw new BadRequestException('AUTOMATION_TITLE_REQUIRED');
      data.title = title;
    }
    if (input.instruction !== undefined) {
      const instruction = cleanText(input.instruction, 20_000);
      if (!instruction) throw new BadRequestException('AUTOMATION_INSTRUCTION_REQUIRED');
      data.instruction = instruction;
    }

    const currentPolicy = this.readPolicy(current);
    let effectiveTrigger = currentPolicy.trigger;
    let nextWakeAt = current.nextWakeAt;
    if (input.trigger !== undefined) {
      const normalized = this.lifecycle.normalizeTrigger(input.trigger, now);
      effectiveTrigger = normalized.trigger;
      data.trigger = normalized.trigger as unknown as Prisma.InputJsonValue;
      nextWakeAt = normalized.nextWakeAt;
      data.nextWakeAt = current.status === 'ACTIVE' ? nextWakeAt : null;
    }

    let expiresAt = current.expiresAt;
    let effectiveStopPolicy = currentPolicy.stopPolicy;
    if (input.stopPolicy !== undefined || (input.trigger !== undefined && effectiveTrigger.kind !== 'once')) {
      const normalized = this.lifecycle.normalizeStopPolicy(
        input.stopPolicy !== undefined ? input.stopPolicy : effectiveStopPolicy,
        now,
        effectiveTrigger.kind !== 'once',
      );
      data.stopPolicy = normalized.stopPolicy as unknown as Prisma.InputJsonValue;
      effectiveStopPolicy = normalized.stopPolicy;
      expiresAt = normalized.expiresAt;
      data.expiresAt = expiresAt;
    }
    let effectiveDeliveryPolicy = currentPolicy.deliveryPolicy;
    if (input.deliveryPolicy !== undefined) {
      effectiveDeliveryPolicy = this.lifecycle.normalizeDeliveryPolicy(input.deliveryPolicy);
      data.deliveryPolicy = effectiveDeliveryPolicy as unknown as Prisma.InputJsonValue;
    }
    if (effectiveDeliveryPolicy.mode === 'on_completion' && !effectiveStopPolicy.completionCondition) {
      throw new BadRequestException('AUTOMATION_COMPLETION_DELIVERY_REQUIRES_CONDITION');
    }
    if (expiresAt && nextWakeAt && nextWakeAt.getTime() >= expiresAt.getTime()) {
      throw new BadRequestException('AUTOMATION_NEXT_RUN_AFTER_EXPIRY');
    }

    const updated = await this.prisma.automation.update({ where: { id: automationId }, data });
    const snapshot = this.snapshot(updated);
    this.realtime.changed(snapshot);
    return snapshot;
  }

  async pause(userId: string, automationId: string): Promise<AutomationSnapshot> {
    const current = await this.owned(userId, automationId);
    if (current.status === 'PAUSED') return this.snapshot(current);
    if (current.status !== 'ACTIVE') throw new BadRequestException('AUTOMATION_NOT_ACTIVE');
    const running = await this.runningTraceIds(automationId);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.automationRun.updateMany({
        where: { automationId, status: 'PENDING' },
        data: { status: 'CANCELLED', completedAt: new Date(), errorCode: 'AUTOMATION_PAUSED' },
      });
      await tx.automationRun.updateMany({
        where: { automationId, status: 'RUNNING' },
        data: { status: 'CANCELLING' },
      });
      return tx.automation.update({
        where: { id: automationId },
        data: { status: 'PAUSED', nextWakeAt: null },
      });
    });
    if (running.length) this.control.requestCancel(running, 'automation_paused');
    const snapshot = this.snapshot(updated);
    this.realtime.changed(snapshot);
    return snapshot;
  }

  async resume(userId: string, automationId: string): Promise<AutomationSnapshot> {
    const current = await this.owned(userId, automationId);
    if (current.status === 'ACTIVE') return this.snapshot(current);
    if (current.status !== 'PAUSED') throw new BadRequestException('AUTOMATION_NOT_PAUSED');
    const openRuns = await this.runningTraceIds(automationId);
    if (openRuns.length) throw new BadRequestException('AUTOMATION_RUN_STILL_STOPPING');
    const now = new Date();
    if (this.lifecycle.shouldStopBeforeRun(current.expiresAt, now)) {
      return this.completeInternal(current.id, 'EXPIRED');
    }
    const { trigger } = this.readPolicy(current);
    const nextWakeAt = this.lifecycle.nextOnResume(trigger, now);
    const updated = await this.prisma.automation.update({
      where: { id: automationId },
      data: { status: 'ACTIVE', nextWakeAt },
    });
    const snapshot = this.snapshot(updated);
    this.realtime.changed(snapshot);
    return snapshot;
  }

  async cancel(
    userId: string,
    automationId: string,
    actor: AutomationCancelActor = 'USER',
    reason = 'user_cancelled',
  ): Promise<AutomationSnapshot> {
    const current = await this.owned(userId, automationId);
    if (current.status === 'CANCELLED') return this.snapshot(current);
    if (current.status === 'COMPLETED') throw new BadRequestException('AUTOMATION_ALREADY_COMPLETED');
    const traceIds = await this.runningTraceIds(automationId);
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.automationRun.updateMany({
        where: { automationId, status: 'PENDING' },
        data: { status: 'CANCELLED', completedAt: now, errorCode: 'AUTOMATION_CANCELLED' },
      });
      await tx.automationRun.updateMany({
        where: { automationId, status: 'RUNNING' },
        data: { status: 'CANCELLING' },
      });
      return tx.automation.update({
        where: { id: automationId },
        data: {
          status: 'CANCELLED',
          nextWakeAt: null,
          cancelledAt: now,
          cancelledBy: actor,
          cancelReason: cleanText(reason, 240) || 'cancelled',
        },
      });
    });
    this.control.requestCancel(traceIds, reason);
    const snapshot = this.snapshot(updated);
    this.realtime.changed(snapshot);
    return snapshot;
  }

  async completeFromTrace(userId: string, traceId: string, reason = 'CONDITION_MET'): Promise<AutomationSnapshot> {
    const run = await this.prisma.automationRun.findFirst({
      where: { traceId, automation: { userId } },
      select: { automationId: true },
    });
    if (!run) throw new ForbiddenException('AUTOMATION_COMPLETE_OUTSIDE_RUN');
    return this.completeInternal(run.automationId, cleanText(reason, 80) || 'CONDITION_MET');
  }

  async summary(userId: string, conversationId: string): Promise<{ activeCount: number }> {
    await this.assertConversationAccess(userId, conversationId);
    const activeCount = await this.prisma.automation.count({
      where: { userId, conversationId, status: { in: [...ACTIVE_AUTOMATION_STATUSES] as any } },
    });
    return { activeCount };
  }

  async cancelByConversationInTransaction(
    tx: Prisma.TransactionClient,
    input: { userId: string; conversationId: string },
    now = new Date(),
  ): Promise<AutomationCleanupResult> {
    const runs = await tx.automationRun.findMany({
      where: {
        automation: {
          userId: input.userId,
          conversationId: input.conversationId,
          status: { in: [...ACTIVE_AUTOMATION_STATUSES] as any },
        },
        status: { in: ['RUNNING', 'CANCELLING'] as any },
      },
      select: { traceId: true, assistantMessageId: true },
    });
    await tx.automationRun.updateMany({
      where: {
        automation: { userId: input.userId, conversationId: input.conversationId },
        status: 'PENDING',
      },
      data: { status: 'CANCELLED', completedAt: now, errorCode: 'CONVERSATION_DELETED' },
    });
    await tx.automationRun.updateMany({
      where: {
        automation: { userId: input.userId, conversationId: input.conversationId },
        status: 'RUNNING',
      },
      data: { status: 'CANCELLING' },
    });

    for (const run of runs) {
      if (!run.assistantMessageId) continue;
      const message = await tx.message.findFirst({
        where: {
          id: run.assistantMessageId,
          conversationId: input.conversationId,
          deletedAt: null,
        },
        select: { id: true, parentMessageId: true, meta: true },
      });
      if (!message) continue;
      const meta = jsonRecord(message.meta);
      const alreadyInternal = String(meta.visibility ?? '').toLowerCase() === 'internal';

      await tx.message.update({
        where: { id: message.id },
        data: {
          content: '',
          status: 'cancelled',
          unfinished: false,
          error: false,
          finishReason: 'cancelled',
          citations: Prisma.JsonNull,
          meta: {
            ...meta,
            visibility: 'internal',
            automationCancelledByConversationDelete: true,
          } as Prisma.InputJsonValue,
        },
      });

      if (message.parentMessageId) {
        await tx.message.updateMany({
          where: {
            conversationId: input.conversationId,
            parentMessageId: message.id,
            deletedAt: null,
          },
          data: { parentMessageId: message.parentMessageId },
        });
        await tx.conversation.updateMany({
          where: {
            id: input.conversationId,
            currentLeafMessageId: message.id,
          },
          data: { currentLeafMessageId: message.parentMessageId },
        });
      }

      if (!alreadyInternal) {
        await tx.conversation.update({
          where: { id: input.conversationId },
          data: { messageCount: { decrement: 1 } },
        });
      }
    }

    const changed = await tx.automation.updateMany({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        status: { in: [...ACTIVE_AUTOMATION_STATUSES] as any },
      },
      data: {
        status: 'CANCELLED',
        nextWakeAt: null,
        cancelledAt: now,
        cancelledBy: 'SYSTEM',
        cancelReason: 'conversation_deleted',
      },
    });
    return {
      cancelledAutomationCount: changed.count,
      runningTraceIds: runs.map((row) => row.traceId).filter((value): value is string => Boolean(value)),
    };
  }

  finalizeConversationCancellation(cleanup: AutomationCleanupResult): void {
    this.control.requestCancel(cleanup.runningTraceIds, 'conversation_deleted');
  }

  async recoverInterruptedRuns(now = new Date()): Promise<number> {
    const interrupted = await this.prisma.automationRun.findMany({
      where: { status: { in: ['RUNNING', 'CANCELLING'] as any } },
      include: { automation: true },
      orderBy: { startedAt: 'asc' },
      take: 200,
    });
    let recovered = 0;
    for (const row of interrupted) {
      const snapshot = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.automationRun.findUnique({
          where: { id: row.id },
          include: { automation: true },
        });
        if (!fresh || !['RUNNING', 'CANCELLING'].includes(String(fresh.status))) return null;
        const automation = fresh.automation;
        const cancelled = automation.status === 'CANCELLED' || automation.status === 'PAUSED' || fresh.status === 'CANCELLING';

        if (fresh.assistantMessageId) {
          const message = await tx.message.findUnique({ where: { id: fresh.assistantMessageId } });
          if (message?.unfinished) {
            await tx.message.update({
              where: { id: message.id },
              data: {
                content: message.content || (cancelled ? '' : 'The automation was interrupted by an application restart and this run has ended.'),
                status: cancelled ? 'cancelled' : 'failed',
                unfinished: false,
                error: !cancelled,
                finishReason: cancelled ? 'cancelled' : 'failed',
                meta: !message.content && !cancelled
                  ? {
                      ...((message.meta && typeof message.meta === 'object' && !Array.isArray(message.meta))
                        ? message.meta as Record<string, unknown>
                        : {}),
                      presentation: { key: 'automation.message.interrupted' },
                    } as Prisma.InputJsonValue
                  : undefined,
              },
            });
          }
        }

        await tx.automationRun.update({
          where: { id: fresh.id },
          data: {
            status: cancelled ? 'CANCELLED' : 'FAILED',
            completedAt: now,
            errorCode: cancelled ? 'AUTOMATION_INTERRUPTED_CANCELLED' : 'AUTOMATION_PROCESS_INTERRUPTED',
            errorMessage: cancelled ? null : 'Automation run was interrupted by process restart',
          },
        });

        if (automation.status !== 'ACTIVE') return this.snapshot(automation);
        const runCount = automation.runCount + 1;
        const { trigger, stopPolicy } = this.readPolicy(automation);
        const completionReason = this.lifecycle.completionReason({
          trigger,
          stopPolicy,
          runCount,
          expiresAt: automation.expiresAt,
          now,
        });
        const nextWakeAt = completionReason ? null : this.lifecycle.nextAfterRun(trigger, fresh.scheduledFor, now);
        const updated = await tx.automation.update({
          where: { id: automation.id },
          data: {
            status: completionReason || !nextWakeAt ? 'COMPLETED' : 'ACTIVE',
            nextWakeAt,
            lastRunAt: now,
            runCount,
            ...((completionReason || !nextWakeAt)
              ? { completedAt: now, completionReason: completionReason ?? 'SCHEDULE_COMPLETED' }
              : {}),
          },
        });
        return this.snapshot(updated);
      }).catch(() => null);
      if (snapshot) {
        recovered += 1;
        this.realtime.changed(snapshot);
      }
    }
    return recovered;
  }

  async expireDue(limit = 10, now = new Date()): Promise<AutomationSnapshot[]> {
    const expired = await this.prisma.automation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true },
      take: Math.max(1, Math.min(limit, 50)),
    });
    const completed: AutomationSnapshot[] = [];
    for (const row of expired) {
      const snapshot = await this.completeInternal(row.id, 'EXPIRED').catch(() => null);
      if (snapshot) completed.push(snapshot);
    }
    return completed;
  }

  async pendingExpiryNotices(limit = 10): Promise<Automation[]> {
    return this.prisma.automation.findMany({
      where: {
        status: 'COMPLETED',
        completionReason: 'EXPIRED',
        expiryNoticeSentAt: null,
        conversation: { deletedAt: null },
      },
      orderBy: { completedAt: 'asc' },
      take: Math.max(1, Math.min(limit, 50)),
    });
  }

  async markExpiryNoticeSent(automationId: string, at = new Date()): Promise<void> {
    await this.prisma.automation.updateMany({
      where: { id: automationId, status: 'COMPLETED', completionReason: 'EXPIRED', expiryNoticeSentAt: null },
      data: { expiryNoticeSentAt: at },
    });
  }

  async claimDue(limit = 10, now = new Date()): Promise<AutomationRun[]> {
    const due = await this.prisma.automation.findMany({
      where: {
        status: 'ACTIVE',
        nextWakeAt: { lte: now },
        runs: {
          none: { status: { in: [...OPEN_RUN_STATUSES] as any } },
        },
      },
      orderBy: { nextWakeAt: 'asc' },
      take: Math.max(1, Math.min(limit, 50)),
    });
    const claimed: AutomationRun[] = [];
    for (const automation of due) {
      if (!automation.nextWakeAt) continue;
      const scheduledFor = automation.nextWakeAt;
      const run = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.automation.updateMany({
          where: {
            id: automation.id,
            status: 'ACTIVE',
            nextWakeAt: scheduledFor,
          },
          data: { nextWakeAt: null },
        });
        if (changed.count !== 1) return null;
        return tx.automationRun.upsert({
          where: { automationId_scheduledFor: { automationId: automation.id, scheduledFor } },
          create: { automationId: automation.id, scheduledFor, status: 'PENDING' },
          update: {},
        });
      });
      if (run) claimed.push(run);
    }
    return claimed;
  }

  async pendingRuns(limit = 10): Promise<AutomationRun[]> {
    return this.prisma.automationRun.findMany({
      where: { status: 'PENDING', automation: { status: 'ACTIVE', conversation: { deletedAt: null } } },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, Math.min(limit, 50)),
    });
  }

  async prepareRun(runId: string, traceId: string): Promise<{ run: AutomationRun; automation: Automation } | null> {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.automationRun.findUnique({
        where: { id: runId },
        include: { automation: true },
      });
      if (!run || run.status !== 'PENDING' || run.automation.status !== 'ACTIVE') return null;
      const policy = this.readPolicy(run.automation).stopPolicy;
      const reachedMaxRuns = Boolean(policy.maxRuns && run.automation.runCount >= policy.maxRuns);
      if (this.lifecycle.shouldStopBeforeRun(run.automation.expiresAt) || reachedMaxRuns) {
        const completionReason = reachedMaxRuns ? 'MAX_RUNS_REACHED' : 'EXPIRED';
        await tx.automation.update({
          where: { id: run.automationId },
          data: { status: 'COMPLETED', nextWakeAt: null, completedAt: new Date(), completionReason },
        });
        await tx.automationRun.update({ where: { id: run.id }, data: { status: 'CANCELLED', completedAt: new Date() } });
        return null;
      }
      const claimed = await tx.automationRun.updateMany({
        where: { id: run.id, status: 'PENDING' },
        data: { status: 'RUNNING', traceId, startedAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      const updated = await tx.automationRun.findUnique({ where: { id: run.id } });
      if (!updated) return null;
      return { run: updated, automation: run.automation };
    });
  }

  async setRunMessages(runId: string, input: { userMessageId: string; assistantMessageId: string }): Promise<void> {
    await this.prisma.automationRun.update({ where: { id: runId }, data: input });
  }

  async finishRun(input: {
    runId: string;
    outcome: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<AutomationSnapshot | null> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.automationRun.findUnique({ where: { id: input.runId }, include: { automation: true } });
      if (!run) return null;
      const terminalAutomation = run.automation.status === 'CANCELLED' || run.automation.status === 'COMPLETED';
      const pausedAutomation = run.automation.status === 'PAUSED';
      await tx.automationRun.update({
        where: { id: run.id },
        data: {
          status: (terminalAutomation || pausedAutomation) && input.outcome !== 'SUCCEEDED' ? 'CANCELLED' : input.outcome,
          completedAt: now,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
        },
      });

      const runCount = run.automation.runCount + (input.outcome === 'CANCELLED' ? 0 : 1);
      if (terminalAutomation || pausedAutomation) {
        const updated = await tx.automation.update({
          where: { id: run.automationId },
          data: { lastRunAt: now, runCount, nextWakeAt: null },
        });
        return this.snapshot(updated);
      }

      const { trigger, stopPolicy } = this.readPolicy(run.automation);
      if (input.outcome === 'BLOCKED') {
        const updated = await tx.automation.update({
          where: { id: run.automationId },
          data: { status: 'PAUSED', nextWakeAt: null, lastRunAt: now, runCount },
        });
        return this.snapshot(updated);
      }

      const completionReason = this.lifecycle.completionReason({
        trigger,
        stopPolicy,
        runCount,
        expiresAt: run.automation.expiresAt,
        now,
      });
      if (completionReason) {
        const updated = await tx.automation.update({
          where: { id: run.automationId },
          data: {
            status: 'COMPLETED',
            nextWakeAt: null,
            lastRunAt: now,
            runCount,
            completedAt: now,
            completionReason,
          },
        });
        return this.snapshot(updated);
      }

                                                                                  
                                                                                     
                                                                                
      const nextWakeAt = run.automation.nextWakeAt
        ?? this.lifecycle.nextAfterRun(trigger, run.scheduledFor, now);
      const updated = await tx.automation.update({
        where: { id: run.automationId },
        data: {
          status: nextWakeAt ? 'ACTIVE' : 'COMPLETED',
          nextWakeAt,
          lastRunAt: now,
          runCount,
          ...(nextWakeAt ? {} : { completedAt: now, completionReason: 'SCHEDULE_COMPLETED' }),
        },
      });
      return this.snapshot(updated);
    }).then((snapshot) => {
      if (snapshot) this.realtime.changed(snapshot);
      return snapshot;
    });
  }

  async markRunPending(runId: string): Promise<void> {
    await this.prisma.automationRun.updateMany({
      where: { id: runId, status: 'RUNNING' },
      data: { status: 'PENDING', traceId: null, startedAt: null },
    });
  }

  async automationForRun(runId: string): Promise<{ run: AutomationRun; automation: Automation } | null> {
    const row = await this.prisma.automationRun.findUnique({ where: { id: runId }, include: { automation: true } });
    return row ? { run: row, automation: row.automation } : null;
  }

  policyOf(automation: Automation): { trigger: AutomationTrigger; stopPolicy: AutomationStopPolicy; deliveryPolicy: AutomationDeliveryPolicy } {
    return this.readPolicy(automation);
  }

  emitChanged(automation: Automation): void {
    this.realtime.changed(this.snapshot(automation));
  }

  snapshot(row: Automation): AutomationSnapshot {
    const { trigger, stopPolicy } = this.readPolicy(row);
    return {
      id: row.id,
      userId: row.userId,
      agentId: row.agentId,
      conversationId: row.conversationId,
      anchorMessageId: row.anchorMessageId ?? null,
      title: row.title,
      instruction: row.instruction,
      trigger,
      stopPolicy,
      deliveryPolicy: this.lifecycle.normalizeDeliveryPolicy(row.deliveryPolicy),
      status: String(row.status) as AutomationSnapshot['status'],
      nextWakeAt: row.nextWakeAt?.toISOString() ?? null,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      runCount: row.runCount,
      completedAt: row.completedAt?.toISOString() ?? null,
      completionReason: row.completionReason ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelledBy: row.cancelledBy ?? null,
      cancelReason: row.cancelReason ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async owned(userId: string, automationId: string): Promise<Automation> {
    const row = await this.prisma.automation.findFirst({
      where: { id: automationId, userId, conversation: { deletedAt: null } },
    });
    if (!row) throw new NotFoundException('AUTOMATION_NOT_FOUND');
    return row;
  }

  private async assertConversationAccess(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException('AUTOMATION_CONVERSATION_NOT_FOUND');
  }

  private async runningTraceIds(automationId: string): Promise<string[]> {
    const rows = await this.prisma.automationRun.findMany({
      where: { automationId, status: { in: [...OPEN_RUN_STATUSES] as any }, traceId: { not: null } },
      select: { traceId: true },
    });
    return rows.map((row) => row.traceId).filter((value): value is string => Boolean(value));
  }

  private async completeInternal(automationId: string, reason: string): Promise<AutomationSnapshot> {
    const now = new Date();
    const current = await this.prisma.automation.findUnique({ where: { id: automationId } });
    if (!current) throw new NotFoundException('AUTOMATION_NOT_FOUND');
    if (current.status === 'COMPLETED') return this.snapshot(current);
    if (current.status === 'CANCELLED') throw new BadRequestException('AUTOMATION_CANCELLED');
    const updated = await this.prisma.automation.update({
      where: { id: automationId },
      data: { status: 'COMPLETED', nextWakeAt: null, completedAt: now, completionReason: reason },
    });
    const snapshot = this.snapshot(updated);
    this.realtime.changed(snapshot);
    return snapshot;
  }

  private readPolicy(row: Automation): { trigger: AutomationTrigger; stopPolicy: AutomationStopPolicy; deliveryPolicy: AutomationDeliveryPolicy } {
    return {
      trigger: row.trigger as unknown as AutomationTrigger,
      stopPolicy: row.stopPolicy as unknown as AutomationStopPolicy,
      deliveryPolicy: this.lifecycle.normalizeDeliveryPolicy(row.deliveryPolicy),
    };
  }
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
