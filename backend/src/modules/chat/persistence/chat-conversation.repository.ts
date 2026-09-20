                                                                       
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { appError } from '../../../common/errors/app-error';

export const DEFAULT_CONVERSATION_TITLE = '';

@Injectable()
export class ChatConversationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async assertUserAccess(input: {
    userId: string;
    conversationId: string;
    tx?: Prisma.TransactionClient;
  }) {
    this.trace.debug('repo.conversation.assert_access_start', {
      userId: input.userId,
      conversationId: input.conversationId,
    });
    const client = input.tx ?? this.prisma;
    const conversation = await client.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, userId: true, agentId: true, currentLeafMessageId: true, meta: true, deletedAt: true },
    } as any);
    if (!conversation) {
      this.trace.warn('repo.conversation.assert_access_failed', {
        userId: input.userId,
        conversationId: input.conversationId,
        reason: 'CONVERSATION_NOT_FOUND',
      });
      throw new NotFoundException(appError('CONVERSATION_NOT_FOUND'));
    }
    if (conversation.userId !== input.userId) {
      this.trace.warn('repo.conversation.assert_access_failed', {
        userId: input.userId,
        conversationId: input.conversationId,
        ownerUserId: conversation.userId,
        reason: 'FORBIDDEN',
      });
      throw new ForbiddenException(appError('CONVERSATION_ACCESS_DENIED'));
    }
    if (conversation.deletedAt) {
      this.trace.warn('repo.conversation.assert_access_failed', {
        userId: input.userId,
        conversationId: input.conversationId,
        reason: 'CONVERSATION_RECYCLED',
      });
      throw new BadRequestException('CONVERSATION_RECYCLED');
    }
    this.trace.debug('repo.conversation.assert_access_done', {
      userId: input.userId,
      conversationId: input.conversationId,
      agentId: conversation.agentId,
      currentLeafMessageId: conversation.currentLeafMessageId ?? null,
    });
    return conversation;
  }

  async getOrCreate(input: { userId: string; agentId: string }) {
    this.trace.event('repo.conversation.get_or_create_start', {
      userId: input.userId,
      agentId: input.agentId,
    });
    await this.assertAgentAccess(input);

    const existing = await this.prisma.conversation.findFirst({
      where: { userId: input.userId, agentId: input.agentId, isArchived: false, deletedAt: null },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    } as any);
    if (existing) {
      this.trace.event('repo.conversation.get_or_create_done', {
        userId: input.userId,
        agentId: input.agentId,
        conversationId: existing.id,
        created: false,
        currentLeafMessageId: existing.currentLeafMessageId ?? null,
      });
      return existing;
    }

    const created = await this.prisma.conversation.create({
      data: {
        userId: input.userId,
        agentId: input.agentId,
        title: DEFAULT_CONVERSATION_TITLE,
        meta: {},
      },
    } as any);
    this.trace.event('repo.conversation.get_or_create_done', {
      userId: input.userId,
      agentId: input.agentId,
      conversationId: created.id,
      created: true,
      currentLeafMessageId: created.currentLeafMessageId ?? null,
    });
    return created;
  }

  async setCurrentLeaf(input: {
    conversationId: string;
    leafMessageId: string;
    at?: Date;
    tx?: Prisma.TransactionClient;
  }) {
    this.trace.event('repo.conversation.set_current_leaf_start', {
      conversationId: input.conversationId,
      leafMessageId: input.leafMessageId,
    });
    const client = input.tx ?? this.prisma;
    const conversation = await client.conversation.update({
      where: { id: input.conversationId },
      data: {
        currentLeafMessageId: input.leafMessageId,
        lastMessageAt: input.at ?? new Date(),
      },
      select: { id: true, currentLeafMessageId: true },
    } as any);
    this.trace.event('repo.conversation.set_current_leaf_done', {
      conversationId: conversation.id,
      currentLeafMessageId: conversation.currentLeafMessageId ?? null,
    });
    return conversation;
  }

  async bumpMessageCount(input: {
    conversationId: string;
    at?: Date;
    tx?: Prisma.TransactionClient;
  }) {
    this.trace.debug('repo.conversation.bump_message_count_start', {
      conversationId: input.conversationId,
    });
    const client = input.tx ?? this.prisma;
    const conversation = await client.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: input.at ?? new Date(),
        messageCount: { increment: 1 },
      },
      select: { id: true },
    } as any);
    this.trace.debug('repo.conversation.bump_message_count_done', {
      conversationId: conversation.id,
    });
    return conversation;
  }

  private async assertAgentAccess(input: { userId: string; agentId: string }) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { id: true, userId: true },
    } as any);
    if (!agent) {
      this.trace.warn('repo.conversation.agent_access_failed', {
        userId: input.userId,
        agentId: input.agentId,
        reason: 'AGENT_NOT_FOUND',
      });
      throw new ForbiddenException(appError('AGENT_NOT_FOUND'));
    }
    if (agent.userId === input.userId) {
      this.trace.debug('repo.conversation.agent_access_owner', {
        userId: input.userId,
        agentId: input.agentId,
      });
      return;
    }

    const access = await this.prisma.userAgent.findFirst({
      where: { userId: input.userId, agentId: input.agentId },
      select: { id: true },
    } as any);
    if (!access) {
      this.trace.warn('repo.conversation.agent_access_failed', {
        userId: input.userId,
        agentId: input.agentId,
        reason: 'NO_USER_AGENT_ACCESS',
      });
      throw new ForbiddenException(appError('AGENT_ACCESS_DENIED'));
    }
    this.trace.debug('repo.conversation.agent_access_granted', {
      userId: input.userId,
      agentId: input.agentId,
      accessId: access.id,
    });
  }
}
