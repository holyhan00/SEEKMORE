import { AgentTurnRepository } from '../../seekmore-agent/persistence/agent-turn.repository';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ChatTurnOrchestratorService } from './chat-turn-orchestrator.service';

@Injectable()
export class ChatTurnRecoveryService implements OnApplicationBootstrap {
  constructor(
    private readonly turns: AgentTurnRepository,
    private readonly prisma: PrismaService,
    private readonly orchestrator: ChatTurnOrchestratorService,
  ) {}

  onApplicationBootstrap(): void {
    void this.recover();
  }

  private async recover(): Promise<void> {
    const interruptedAt = new Date();
    const active = await this.prisma.chatTurnRequest.findMany({
      where: { status: { in: ['STARTING', 'RUNNING'] } },
      select: {
        id: true,
        status: true,
        traceId: true,
        conversationId: true,
        userMessageId: true,
        assistantMessageId: true,
      },
    });

    for (const item of active) {
      const traceId = item.traceId ? String(item.traceId) : '';
      if (!traceId) {
        await this.failInterrupted([item], interruptedAt, 'CHAT_TURN_PROCESS_INTERRUPTED_NO_TRACE');
        continue;
      }

      const [checkpointPhase, anchorCount] = await Promise.all([
        this.turns.latestCheckpointPhase(traceId),
        this.prisma.message.count({
          where: { conversationId: item.conversationId, traceId },
        }),
      ]);

      const hasAnchors = Boolean(item.userMessageId && item.assistantMessageId) || anchorCount > 0;
      const safeResume = item.status === 'STARTING'
        ? true
        : checkpointPhase === 'ready';

      if (safeResume) {
        const resumed = await this.orchestrator.resumeRecoveredRequest(item.id, hasAnchors);
        if (resumed) continue;
      }

      await this.failInterrupted(
        [item],
        interruptedAt,
        checkpointPhase === 'executing_tools'
          ? 'CHAT_TURN_PROCESS_INTERRUPTED_UNSAFE_BOUNDARY'
          : 'CHAT_TURN_PROCESS_INTERRUPTED_NO_SAFE_CHECKPOINT',
      );
    }

    const cancelling = await this.prisma.chatTurnRequest.findMany({
      where: { status: 'CANCELLING' },
      select: { id: true, traceId: true, assistantMessageId: true },
    });

    if (cancelling.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.chatTurnRequest.updateMany({
          where: { id: { in: cancelling.map((item) => item.id) } },
          data: {
            status: 'CANCELLED',
            cleanupStatus: 'TIMED_OUT',
            cleanupCompletedAt: interruptedAt,
            completedAt: interruptedAt,
            version: { increment: 1 },
          },
        });

        const assistantIds = cancelling
          .map((item) => item.assistantMessageId)
          .filter((value): value is string => Boolean(value));
        if (assistantIds.length > 0) {
          await tx.message.updateMany({
            where: { id: { in: assistantIds }, unfinished: true },
            data: {
              status: 'cancelled',
              unfinished: false,
              error: false,
              finishReason: 'cancelled_after_restart',
            },
          });
        }

        const traces = cancelling
          .map((item) => item.traceId)
          .filter((value): value is string => Boolean(value));
        if (traces.length > 0) {
          await tx.agentTurn.updateMany({
            where: {
              traceId: { in: traces },
              status: {
                notIn: [
                  'succeeded',
                  'partial',
                  'failed',
                  'blocked',
                  'cancelled',
                ],
              },
            },
            data: {
              status: 'cancelled',
              completedAt: interruptedAt,
            },
          });
          const terminalTurns = await tx.agentTurn.findMany({ where: { traceId: { in: traces }, status: 'cancelled' } });
          for (const turn of terminalTurns) await this.turns.writeTerminalOutbox(tx, turn, 'cancelled', interruptedAt);
        }
      });
    }

    const waiting = await this.prisma.chatTurnRequest.findMany({ where: { status: 'WAITING_USER' }, select: { conversationId: true } });
    for (const item of waiting) await this.orchestrator.resumeWaitingUser(item.conversationId);
    const queued = await this.prisma.chatTurnRequest.findMany({
      where: { status: 'QUEUED', conversation: { deletedAt: null } },
      distinct: ['conversationId'],
      select: { conversationId: true },
    });
    for (const item of queued) {
      this.orchestrator.scheduleDrain(item.conversationId);
    }
  }

  private async failInterrupted(
    active: Array<{ id: string; traceId: string | null; assistantMessageId: string | null }>,
    interruptedAt: Date,
    failureCode: string,
  ): Promise<void> {
    if (!active.length) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.chatTurnRequest.updateMany({
        where: { id: { in: active.map((item) => item.id) } },
        data: {
          status: 'FAILED',
          failureCode,
          failureMessage: 'Backend process interrupted the active turn before a safe resume boundary',
          completedAt: interruptedAt,
          version: { increment: 1 },
        },
      });

      const assistantIds = active
        .map((item) => item.assistantMessageId)
        .filter((value): value is string => Boolean(value));

      for (const assistantMessageId of assistantIds) {
        const message = await tx.message.findUnique({ where: { id: assistantMessageId }, select: { meta: true } });
        const meta = this.record(message?.meta);
        await tx.message.updateMany({
          where: { id: assistantMessageId, unfinished: true },
          data: {
            status: 'failed',
            unfinished: false,
            error: true,
            finishReason: 'process_interrupted',
            meta: {
              ...meta,
              interrupted: true,
              interruptedAt: interruptedAt.toISOString(),
              interruptionCode: failureCode,
            } as Prisma.InputJsonValue,
          },
        });
      }

      const traces = active
        .map((item) => item.traceId)
        .filter((value): value is string => Boolean(value));
      if (traces.length > 0) {
        await tx.agentTurn.updateMany({
          where: {
            traceId: { in: traces },
            status: { notIn: ['succeeded', 'partial', 'failed', 'blocked', 'cancelled'] },
          },
          data: {
            status: 'failed',
            errorJson: {
              code: failureCode,
              message: 'Backend process interrupted the active turn before a safe resume boundary',
            },
            completedAt: interruptedAt,
          },
        });
        const terminalTurns = await tx.agentTurn.findMany({ where: { traceId: { in: traces }, status: 'failed' } });
        for (const turn of terminalTurns) await this.turns.writeTerminalOutbox(tx, turn, 'failed', interruptedAt);
      }
    });
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
