import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RuntimeEventBus } from '../../chat/runtime-events/runtime-event.bus';
import { RuntimeAssistantTimelineBus } from '../../chat/runtime-events/runtime-assistant-timeline.bus';
import { MessageObjectLinkService } from '../../object-runtime/message-object/message-object.service';
import type { AgentTurnFinalizationCommit, AgentTurnPauseCommit } from '../contracts/finalization.types';

@Injectable()
export class AgentTurnFinalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RuntimeEventBus,
    private readonly messageObjects: MessageObjectLinkService,
    @Optional() private readonly timeline?: RuntimeAssistantTimelineBus,
  ) {}

  async commitTerminal(input: AgentTurnFinalizationCommit): Promise<'committed' | 'idempotent'> {
    await this.timeline?.flush(input.assistantMessageId);
    const existing = await this.prisma.message.findUnique({ where: { id: input.assistantMessageId } });
    if (!existing) throw new Error(`ASSISTANT_MESSAGE_NOT_FOUND:${input.assistantMessageId}`);
    const meta = this.meta(existing.meta, input.finalizationKey);
    if ((existing.meta as any)?.agentFinalizationKey === input.finalizationKey) return 'idempotent';
    if (!existing.unfinished && existing.finishReason) return 'idempotent';
    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: input.assistantMessageId },
        data: {
          content: input.content,
          status: input.terminalStatus === 'failed' ? 'failed' : input.terminalStatus === 'cancelled' ? 'cancelled' : 'finished',
          unfinished: false,
          error: input.terminalStatus === 'failed',
          finishReason: input.terminalStatus,
          citations: input.citations == null ? Prisma.JsonNull : input.citations as unknown as Prisma.InputJsonValue,
          meta: {
            ...meta,
            runtime: input.runtime ?? null,
            metadata: input.metadata ?? null,
            reasonCodes: input.reasonCodes ?? [],
          } as Prisma.InputJsonValue,
        },
      });
      if (
        (input.terminalStatus === 'succeeded' || input.terminalStatus === 'partially_succeeded')
        && (input.outputObjects?.length ?? 0) > 0
      ) {
        if (!input.userId || !input.agentId) {
          throw new Error('ASSISTANT_OUTPUT_PARTITION_REQUIRED');
        }
        await this.messageObjects.bindAssistantOutputs(tx, {
          userId: input.userId,
          agentId: input.agentId,
          conversationId: input.conversationId,
          messageId: input.assistantMessageId,
          objects: [...(input.outputObjects ?? [])],
        });
      }
      await this.advanceConversationLeaf(tx, {
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        expectedCurrentLeafMessageId: input.expectedCurrentLeafMessageId,
      });
    });
    this.events.publish({
      type: 'runtime.finalization_committed',
      stage: 'delivery',
      status: input.terminalStatus === 'failed' ? 'failed' : input.terminalStatus === 'cancelled' ? 'cancelled' : 'succeeded',
      source: 'seekmore-agent',
      scope: { conversationId: input.conversationId, messageId: input.assistantMessageId, requestId: input.traceId },
      refs: { traceId: input.traceId },
      reasonCodes: ['agent_turn:finalization_committed', ...(input.reasonCodes ?? [])],
      payload: { content: input.content, citations: input.citations ?? [], runtime: input.runtime ?? {} },
    });
    this.timeline?.clear(input.assistantMessageId);
    return 'committed';
  }

  async commitPause(input: AgentTurnPauseCommit): Promise<'committed' | 'idempotent'> {
    await this.timeline?.flush(input.assistantMessageId);
    const existing = await this.prisma.message.findUnique({ where: { id: input.assistantMessageId } });
    if (!existing) throw new Error(`ASSISTANT_MESSAGE_NOT_FOUND:${input.assistantMessageId}`);
    if ((existing.meta as any)?.agentFinalizationKey === input.finalizationKey) return 'idempotent';
    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: input.assistantMessageId },
        data: {
          content: input.content,
          status: input.pauseStatus,
          unfinished: true,
          error: false,
          finishReason: null,
          citations: input.citations == null ? Prisma.JsonNull : input.citations as unknown as Prisma.InputJsonValue,
          meta: {
            ...this.meta(existing.meta, input.finalizationKey),
            runtime: input.runtime ?? null,
            metadata: input.metadata ?? null,
            reasonCodes: input.reasonCodes ?? [],
          } as Prisma.InputJsonValue,
        },
      });
      await this.advanceConversationLeaf(tx, {
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        expectedCurrentLeafMessageId: input.expectedCurrentLeafMessageId,
      });
    });
    this.timeline?.clear(input.assistantMessageId);
    return 'committed';
  }

  commitUnhandledFailure(input: {
    traceId: string;
    conversationId: string;
    assistantMessageId: string;
    errorMessage: string;
    content: string;
    finalizationKey: string;
    metadata?: Record<string, unknown> | null;
    expectedCurrentLeafMessageId?: string | null;
  }) {
    return this.commitTerminal({
      ...input,
      citations: [],
      runtime: { failure: { message: input.errorMessage } },
      metadata: { ...(input.metadata ?? {}), unhandledFailure: true },
      reasonCodes: ['agent_turn:unhandled_failure'],
      terminalStatus: 'failed',
    });
  }

  commitCancelled(input: {
    traceId: string;
    conversationId: string;
    assistantMessageId: string;
    content?: string;
    finalizationKey: string;
    metadata?: Record<string, unknown> | null;
    expectedCurrentLeafMessageId?: string | null;
  }) {
    return this.commitTerminal({
      ...input,
      content: input.content ?? '',
      citations: [],
      runtime: { cancelled: true },
      metadata: { ...(input.metadata ?? {}), cancelled: true },
      reasonCodes: ['agent_turn:cancelled'],
      terminalStatus: 'cancelled',
    });
  }


  private async advanceConversationLeaf(
    tx: Prisma.TransactionClient,
    input: {
      conversationId: string;
      assistantMessageId: string;
      expectedCurrentLeafMessageId?: string | null;
    },
  ): Promise<void> {
    if (input.expectedCurrentLeafMessageId === undefined) {
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { currentLeafMessageId: input.assistantMessageId, lastMessageAt: new Date() },
      });
      return;
    }

    await tx.conversation.updateMany({
      where: {
        id: input.conversationId,
        currentLeafMessageId: input.expectedCurrentLeafMessageId,
      },
      data: { currentLeafMessageId: input.assistantMessageId, lastMessageAt: new Date() },
    });
  }

  private meta(value: unknown, finalizationKey: string): Record<string, unknown> {
    const existing = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return { ...existing, agentFinalizationKey: finalizationKey, finalizedAt: new Date().toISOString() };
  }
}
