import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type ChatTurnRequest } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { normalizeClientLocaleSnapshot } from '../../localization/locale-normalizer';
import { PrismaService } from '../../../../prisma/prisma.service';
import type {
  ChatTurnQueueSnapshot,
  ChatTurnRequestStatus,
  ChatTurnRequestView,
  PersistedChatTurnPayload,
  SubmitChatTurnCommand,
} from './chat-turn-request.types';
import { ACTIVE_CHAT_TURN_STATUSES } from './chat-turn-request.types';

type StoredRequest = ChatTurnRequest & { payload: unknown };

@Injectable()
export class ChatTurnRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async submit(command: SubmitChatTurnCommand): Promise<{ request: StoredRequest; queuePosition: number }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockConversation(tx, command.conversationId);
      const conversation = await tx.conversation.findFirst({
        where: {
          id: command.conversationId,
          userId: command.userId,
          agentId: command.agentId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!conversation) {
        throw new BadRequestException('CONVERSATION_RECYCLED');
      }
      const existing = await tx.chatTurnRequest.findUnique({
        where: { conversationId_clientMessageId: {
          conversationId: command.conversationId,
          clientMessageId: command.clientMessageId,
        } },
      });
      if (existing) {
        return { request: existing as StoredRequest, queuePosition: await this.position(tx, existing) };
      }
      const aggregate = await tx.chatTurnRequest.aggregate({
        where: { conversationId: command.conversationId },
        _max: { sequence: true },
      });
      const payload: PersistedChatTurnPayload = {
        content: command.content,
        objectRefs: command.objectRefs,
        model: command.model,
        runtimeOptions: command.runtimeOptions,
        explicitSkillIds: command.explicitSkillIds,
        localeContext: command.localeContext ?? null,
      };
      const request = await tx.chatTurnRequest.create({
        data: {
          clientMessageId: command.clientMessageId,
          userId: command.userId,
          agentId: command.agentId,
          conversationId: command.conversationId,
          sequence: (aggregate._max.sequence ?? 0n) + 1n,
          status: 'QUEUED',
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
      return { request: request as StoredRequest, queuePosition: await this.position(tx, request) };
    });
  }

  async claimNext(conversationId: string): Promise<StoredRequest | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockConversation(tx, conversationId);
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
        select: { id: true },
      });
      if (!conversation) return null;
      const active = await tx.chatTurnRequest.findFirst({
        where: { conversationId, status: { in: [...ACTIVE_CHAT_TURN_STATUSES] as any } },
        select: { id: true },
      });
      if (active) return null;
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "ChatTurnRequest"
        WHERE "conversationId" = ${conversationId} AND "status" = 'QUEUED'
        ORDER BY "sequence" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      `);
      const id = rows[0]?.id;
      if (!id) return null;
      const traceId = uuidv4();
      const changed = await tx.chatTurnRequest.updateMany({
        where: { id, status: 'QUEUED' },
        data: { status: 'STARTING', traceId, startedAt: new Date(), version: { increment: 1 } },
      });
      if (changed.count !== 1) return null;
      return await tx.chatTurnRequest.findUnique({ where: { id } }) as StoredRequest | null;
    });
  }

  async claimUserResume(id: string): Promise<StoredRequest | null> {
    const changed = await this.prisma.chatTurnRequest.updateMany({ where: { id, status: 'WAITING_USER' }, data: { status: 'STARTING', version: { increment: 1 } } });
    return changed.count === 1 ? this.findById(id) : null;
  }

  async claimRecovery(id: string): Promise<StoredRequest | null> {
    const changed = await this.prisma.chatTurnRequest.updateMany({
      where: { id, status: { in: ['STARTING', 'RUNNING'] } },
      data: { status: 'STARTING', completedAt: null, failureCode: null, failureMessage: null, version: { increment: 1 } },
    });
    return changed.count === 1 ? this.findById(id) : null;
  }

  async markRunning(requestId: string, traceId: string, anchors: { userMessageId: string; assistantMessageId: string }): Promise<StoredRequest | null> {
    const changed = await this.prisma.chatTurnRequest.updateMany({
      where: { id: requestId, traceId, status: 'STARTING' },
      data: { ...anchors, status: 'RUNNING', version: { increment: 1 } },
    });
    return changed.count === 1 ? this.findById(requestId) : null;
  }

  async markWaiting(requestId: string, traceId: string, status: 'WAITING_APPROVAL' | 'WAITING_EXTERNAL' | 'WAITING_USER'): Promise<StoredRequest | null> {
    const changed = await this.prisma.chatTurnRequest.updateMany({
      where: { id: requestId, traceId, status: 'RUNNING' },
      data: { status, version: { increment: 1 } },
    });
    return changed.count === 1 ? this.findById(requestId) : null;
  }

  async markCancelling(requestId: string, traceId: string, reason: string): Promise<StoredRequest | null> {
    const changed = await this.prisma.chatTurnRequest.updateMany({
      where: { id: requestId, traceId, status: { in: ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_EXTERNAL', 'WAITING_USER'] } },
      data: {
        status: 'CANCELLING', cleanupStatus: 'PENDING', cancelReason: reason,
        cancelRequestedAt: new Date(), cleanupRequestedAt: new Date(), version: { increment: 1 },
      },
    });
    return changed.count === 1 ? this.findById(requestId) : null;
  }

  async markTerminal(input: {
    requestId: string;
    traceId: string;
    status: 'CANCELLED' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'BLOCKED';
    failureCode?: string | null;
    failureMessage?: string | null;
    cleanupStatus?: 'NOT_REQUIRED' | 'CONFIRMED' | 'PARTIAL' | 'TIMED_OUT';
  }): Promise<StoredRequest | null> {
    const allowed = input.status === 'CANCELLED'
      ? ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_EXTERNAL', 'WAITING_USER', 'CANCELLING']
      : input.status === 'FAILED'
        ? ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_EXTERNAL', 'WAITING_USER']
        : ['RUNNING', 'WAITING_APPROVAL', 'WAITING_EXTERNAL', 'WAITING_USER'];
    const changed = await this.prisma.chatTurnRequest.updateMany({
      where: { id: input.requestId, traceId: input.traceId, status: { in: allowed as any } },
      data: {
        status: input.status,
        cleanupStatus: input.cleanupStatus ?? (input.status === 'CANCELLED' ? 'CONFIRMED' : 'NOT_REQUIRED'),
        cleanupCompletedAt: input.status === 'CANCELLED' ? new Date() : undefined,
        failureCode: input.failureCode ?? undefined,
        failureMessage: input.failureMessage ?? undefined,
        completedAt: new Date(), version: { increment: 1 },
      },
    });
    return changed.count === 1 ? this.findById(input.requestId) : null;
  }

  async findByClientInput(conversationId: string, clientMessageId: string) {
    return this.prisma.chatTurnRequest.findUnique({ where: { conversationId_clientMessageId: { conversationId, clientMessageId } } });
  }

  async findActive(conversationId: string): Promise<StoredRequest | null> {
    return this.prisma.chatTurnRequest.findFirst({
      where: { conversationId, status: { in: [...ACTIVE_CHAT_TURN_STATUSES] as any } },
      orderBy: { sequence: 'asc' },
    }) as Promise<StoredRequest | null>;
  }

  async findById(id: string): Promise<StoredRequest | null> {
    return this.prisma.chatTurnRequest.findUnique({ where: { id } }) as Promise<StoredRequest | null>;
  }

  async snapshot(conversationId: string, lastEventSequence: string): Promise<ChatTurnQueueSnapshot> {
    const [active, queued] = await Promise.all([
      this.findActive(conversationId),
      this.prisma.chatTurnRequest.findMany({ where: { conversationId, status: 'QUEUED' }, orderBy: { sequence: 'asc' } }) as Promise<StoredRequest[]>,
    ]);
    return {
      conversationId,
      active: active ? this.view(active, 0) : null,
      queued: queued.map((row, index) => this.view(row, index + 1)),
      lastEventSequence,
    };
  }

  view(row: StoredRequest, position = 0): ChatTurnRequestView {
    const payload = this.payload(row.payload);
    return {
      requestId: row.id, clientMessageId: row.clientMessageId, conversationId: row.conversationId,
      traceId: row.traceId, sequence: row.sequence.toString(), version: row.version, position,
      status: row.status as ChatTurnRequestStatus, content: payload.content,
      objectCount: payload.objectRefs.length, userMessageId: row.userMessageId,
      assistantMessageId: row.assistantMessageId, createdAt: row.createdAt.toISOString(),
    };
  }

  payload(value: unknown): PersistedChatTurnPayload {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value as any : {};
    return {
      content: String(row.content ?? ''),
      objectRefs: Array.isArray(row.objectRefs) ? row.objectRefs : [],
      model: typeof row.model === 'string' ? row.model : null,
      runtimeOptions: row.runtimeOptions && typeof row.runtimeOptions === 'object' ? row.runtimeOptions : null,
      explicitSkillIds: Array.isArray(row.explicitSkillIds) ? row.explicitSkillIds.map(String) : [],
      localeContext: normalizeClientLocaleSnapshot(row.localeContext),
    };
  }

  private async lockConversation(tx: Prisma.TransactionClient, conversationId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtext(${conversationId}))::text AS "lock"
    `);
  }

  private async position(tx: Prisma.TransactionClient, row: { conversationId: string; sequence: bigint; status: unknown }): Promise<number> {
    if (row.status !== 'QUEUED') return 0;
    return tx.chatTurnRequest.count({ where: { conversationId: row.conversationId, status: 'QUEUED', sequence: { lte: row.sequence } } });
  }
}
