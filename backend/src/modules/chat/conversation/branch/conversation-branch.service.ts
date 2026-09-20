// backend/src/modules/chat/conversation/branch/conversation-branch.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Conversation, type Message } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { ConversationBranchSnapshotService } from './conversation-branch-snapshot.service';
import { ConversationBranchObjectSnapshotService } from './conversation-branch-object-snapshot.service';
import type { ConversationBranchResult } from './conversation-branch.types';

@Injectable()
export class ConversationBranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: ConversationBranchSnapshotService,
    private readonly objects: ConversationBranchObjectSnapshotService,
  ) {}

  async create(input: {
    userId: string;
    conversationId: string;
    fromMessageId: string;
    requestId: string;
  }): Promise<ConversationBranchResult> {
    const normalized = {
      userId: requireText(input.userId, 'BRANCH_USER_ID_REQUIRED'),
      conversationId: requireText(input.conversationId, 'BRANCH_CONVERSATION_ID_REQUIRED'),
      fromMessageId: requireText(input.fromMessageId, 'BRANCH_FROM_MESSAGE_ID_REQUIRED'),
      requestId: requireText(input.requestId, 'BRANCH_REQUEST_ID_REQUIRED'),
    };

    const existing = await this.findByRequestId(normalized.userId, normalized.requestId);
    if (existing) {
      this.assertIdempotentRequestMatches(existing, normalized);
      return this.toResult(existing, true);
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => this.createInTransaction(tx, normalized),
        { timeout: 20_000 },
      );
    } catch (error) {
      if (isUniqueConflict(error)) {
        const raced = await this.findByRequestId(normalized.userId, normalized.requestId);
        if (raced) {
          this.assertIdempotentRequestMatches(raced, normalized);
          return this.toResult(raced, true);
        }
      }
      throw error;
    }
  }

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      conversationId: string;
      fromMessageId: string;
      requestId: string;
    },
  ): Promise<ConversationBranchResult> {
    const source = await tx.conversation.findUnique({
      where: { id: input.conversationId },
    });
    if (!source || source.deletedAt) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'CONVERSATION_NOT_FOUND' });
    if (source.userId !== input.userId) throw new ForbiddenException({ code: 'CONVERSATION_ACCESS_DENIED', message: 'CONVERSATION_ACCESS_DENIED' });
    if (source.isArchived) throw new BadRequestException({ code: 'CONVERSATION_ARCHIVED_BRANCH_FORBIDDEN', message: 'CONVERSATION_ARCHIVED_BRANCH_FORBIDDEN' });

    const sourceMessages = await tx.message.findMany({
      where: { conversationId: source.id, deletedAt: null },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
    const chain = this.snapshots.buildAncestorChain({
      conversationId: source.id,
      fromMessageId: input.fromMessageId,
      messages: sourceMessages,
    });
    if (chain.length === 0) {
      throw new BadRequestException({ code: 'BRANCH_CONTEXT_EMPTY', message: 'BRANCH_CONTEXT_EMPTY' });
    }

    const targetConversationId = randomUUID();
    const createdAt = new Date();
    const conversationMeta = this.snapshots.sanitizeConversationMeta(source.meta, {
      parentConversationId: source.id,
      branchFromMessageId: input.fromMessageId,
    });
    const conversation = await tx.conversation.create({
      data: {
        id: targetConversationId,
        userId: source.userId,
        agentId: source.agentId,
        title: buildBranchTitle(source.title),
        titleVersion: source.titleVersion,
        titleUpdatedAt: source.titleUpdatedAt,
        endpoint: source.endpoint,
        model: source.model,
        pinned: false,
        isTemporary: false,
        isArchived: false,
        messageCount: chain.length,
        lastMessageAt: createdAt,
        meta: conversationMeta as Prisma.InputJsonObject,
        parentConversationId: source.id,
        branchFromMessageId: input.fromMessageId,
        branchRequestId: input.requestId,
      },
    });

    const branchId = randomUUID();
    const sourceToTargetMessageId = new Map<string, string>();
    let rootMessageId: string | null = null;
    let parentMessageId: string | null = null;

    for (const sourceMessage of chain) {
      const targetMessageId = randomUUID();
      if (!rootMessageId) rootMessageId = targetMessageId;
      sourceToTargetMessageId.set(sourceMessage.id, targetMessageId);

      await tx.message.create({
        data: this.messageSnapshotData({
          source: sourceMessage,
          targetMessageId,
          targetConversationId,
          parentMessageId,
          rootMessageId,
          branchId,
          branchSnapshotBoundary: sourceMessage.id === input.fromMessageId,
        }),
      });
      parentMessageId = targetMessageId;
    }

    if (!parentMessageId) {
      throw new BadRequestException({ code: 'BRANCH_SNAPSHOT_CREATE_FAILED', message: 'BRANCH_SNAPSHOT_CREATE_FAILED' });
    }

    const sourceToTargetObjectId = await this.objects.cloneMessageObjects({
      tx,
      userId: source.userId,
      agentId: source.agentId,
      sourceConversationId: source.id,
      targetConversationId,
      sourceToTargetMessageId,
    });
    await this.remapCopiedMessageObjectReferences({
      tx,
      chain,
      targetConversationId,
      sourceToTargetMessageId,
      sourceToTargetObjectId,
    });
    await this.cloneSkillActivations(tx, source.id, targetConversationId, createdAt);

    const finalized = await tx.conversation.update({
      where: { id: targetConversationId },
      data: {
        currentLeafMessageId: parentMessageId,
        meta: this.snapshots.remapJsonReferences(
          conversationMeta,
          sourceToTargetObjectId,
        ) as Prisma.InputJsonObject,
      },
    });

    return this.toResult(finalized, false);
  }

  private messageSnapshotData(input: {
    source: Message;
    targetMessageId: string;
    targetConversationId: string;
    parentMessageId: string | null;
    rootMessageId: string;
    branchId: string;
    branchSnapshotBoundary: boolean;
  }): Prisma.MessageUncheckedCreateInput {
    const source = input.source;
    return {
      id: input.targetMessageId,
      conversationId: input.targetConversationId,
      parentMessageId: input.parentMessageId,
      rootMessageId: input.rootMessageId,
      branchId: input.branchId,
      role: source.role,
      content: source.content,
      ...(source.contentParts !== null
        ? { contentParts: this.snapshots.cloneJson(source.contentParts) as Prisma.InputJsonValue }
        : {}),
      traceId: null,
      senderType: source.senderType,
      senderUserId: source.senderUserId,
      senderAgentId: source.senderAgentId,
      model: source.model,
      endpoint: source.endpoint,
      tokenCount: source.tokenCount,
      summary: source.summary,
      summaryTokenCount: source.summaryTokenCount,
      status: 'finished',
      unfinished: false,
      error: false,
      finishReason: source.finishReason,
      ...(source.citations !== null
        ? { citations: this.snapshots.cloneJson(source.citations) as Prisma.InputJsonValue }
        : {}),
      meta: this.snapshots.sanitizeMessageMeta(source.meta, {
        role: source.role,
        sourceConversationId: source.conversationId,
        sourceMessageId: source.id,
        targetConversationId: input.targetConversationId,
        targetMessageId: input.targetMessageId,
        branchSnapshotBoundary: input.branchSnapshotBoundary,
      }) as Prisma.InputJsonObject,
      timestamp: source.timestamp,
      deletedAt: null,
    };
  }

  private async remapCopiedMessageObjectReferences(input: {
    tx: Prisma.TransactionClient;
    chain: Message[];
    targetConversationId: string;
    sourceToTargetMessageId: ReadonlyMap<string, string>;
    sourceToTargetObjectId: ReadonlyMap<string, string>;
  }): Promise<void> {
    if (input.sourceToTargetObjectId.size === 0) return;

    for (const source of input.chain) {
      const targetMessageId = input.sourceToTargetMessageId.get(source.id);
      if (!targetMessageId) continue;

      const data: Prisma.MessageUpdateInput = {
        meta: this.snapshots.remapJsonReferences(
          this.snapshots.sanitizeMessageMeta(source.meta, {
            role: source.role,
            sourceConversationId: source.conversationId,
            sourceMessageId: source.id,
            targetConversationId: input.targetConversationId,
            targetMessageId,
            branchSnapshotBoundary:
              source.id === input.chain[input.chain.length - 1]?.id,
          }),
          input.sourceToTargetObjectId,
        ) as Prisma.InputJsonObject,
      };
      if (source.contentParts !== null) {
        data.contentParts = this.snapshots.remapJsonReferences(
          source.contentParts,
          input.sourceToTargetObjectId,
        ) as Prisma.InputJsonValue;
      }
      if (source.citations !== null) {
        data.citations = this.snapshots.remapJsonReferences(
          source.citations,
          input.sourceToTargetObjectId,
        ) as Prisma.InputJsonValue;
      }

      await input.tx.message.update({
        where: { id: targetMessageId },
        data,
      });
    }
  }

  private async cloneSkillActivations(
    tx: Prisma.TransactionClient,
    sourceConversationId: string,
    targetConversationId: string,
    now: Date,
  ): Promise<void> {
    const activations = await tx.conversationSkillActivation.findMany({
      where: {
        conversationId: sourceConversationId,
        enabled: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    if (activations.length === 0) return;

    await tx.conversationSkillActivation.createMany({
      data: activations.map((activation) => ({
        conversationId: targetConversationId,
        skillId: activation.skillId,
        activationMode: activation.activationMode,
        enabled: activation.enabled,
        priority: activation.priority,
        config: this.snapshots.cloneJson(activation.config) as Prisma.InputJsonValue,
        selectedVersionId: activation.selectedVersionId,
        createdByUserId: activation.createdByUserId,
        expiresAt: activation.expiresAt,
      })),
      skipDuplicates: true,
    });
  }

  private async findByRequestId(
    userId: string,
    requestId: string,
  ): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({
      where: {
        userId,
        branchRequestId: requestId,
        deletedAt: null,
      },
    });
  }

  private assertIdempotentRequestMatches(
    conversation: Conversation,
    input: { conversationId: string; fromMessageId: string },
  ): void {
    if (
      conversation.parentConversationId !== input.conversationId
      || conversation.branchFromMessageId !== input.fromMessageId
    ) {
      throw new ConflictException({ code: 'BRANCH_REQUEST_ID_CONFLICT', message: 'BRANCH_REQUEST_ID_CONFLICT' });
    }
  }

  private toResult(
    conversation: Conversation,
    idempotent: boolean,
  ): ConversationBranchResult {
    if (!conversation.parentConversationId || !conversation.branchFromMessageId || !conversation.branchRequestId) {
      throw new BadRequestException({ code: 'BRANCH_METADATA_INVALID', message: 'BRANCH_METADATA_INVALID' });
    }
    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        agentId: conversation.agentId,
        createdAt: conversation.createdAt,
        titleVersion: conversation.titleVersion,
        titleUpdatedAt: conversation.titleUpdatedAt,
        messageCount: conversation.messageCount,
      },
      branch: {
        parentConversationId: conversation.parentConversationId,
        branchFromMessageId: conversation.branchFromMessageId,
        requestId: conversation.branchRequestId,
        idempotent,
      },
    };
  }
}

function requireText(value: unknown, code: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new BadRequestException({ code, message: code });
  return normalized;
}


function buildBranchTitle(value: unknown): string {
  const title = String(value ?? '').trim();
  if (!title) return '分支';
  return title.startsWith('分支｜')
    ? title
    : `分支｜${title}`;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === 'P2002';
}