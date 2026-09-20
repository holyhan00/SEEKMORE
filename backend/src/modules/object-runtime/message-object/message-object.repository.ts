import { Injectable } from '@nestjs/common';
import type { MessageObjectRole, Prisma, RuntimeObject } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { MessageObjectLinkWithObject, MessageObjectPartition } from './message-object.types';

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class MessageObjectLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAvailableObjects(
    client: DbClient,
    partition: MessageObjectPartition,
    objectIds: string[],
  ): Promise<RuntimeObject[]> {
    if (objectIds.length === 0) return Promise.resolve([]);
    return client.runtimeObject.findMany({
      where: {
        id: { in: objectIds },
        userId: partition.userId,
        agentId: partition.agentId,
        conversationId: partition.conversationId,
        visibility: 'user_visible',
        status: 'available',
        deletedAt: null,
      },
    });
  }

  async createLinks(
    client: DbClient,
    input: {
      messageId: string;
      role: MessageObjectRole;
      refs: Array<{ objectId: string; position: number }>;
    },
  ): Promise<void> {
    if (input.refs.length === 0) return;
    await client.messageObjectLink.createMany({
      data: input.refs.map((ref) => ({
        messageId: input.messageId,
        objectId: ref.objectId,
        role: input.role,
        position: ref.position,
      })),
      skipDuplicates: true,
    });
  }

  listByMessageIds(input: {
    messageIds: string[];
    userId: string;
    conversationId: string;
  }): Promise<MessageObjectLinkWithObject[]> {
    if (input.messageIds.length === 0) return Promise.resolve([]);
    return this.prisma.messageObjectLink.findMany({
      where: {
        messageId: { in: input.messageIds },
        message: { conversationId: input.conversationId, deletedAt: null },
        object: {
          userId: input.userId,
          conversationId: input.conversationId,
          visibility: 'user_visible',
          status: 'available',
          deletedAt: null,
        },
      },
      include: {
        object: true,
        message: {
          select: { role: true, conversationId: true },
        },
      },
      orderBy: [{ messageId: 'asc' }, { role: 'asc' }, { position: 'asc' }, { id: 'asc' }],
    }) as Promise<MessageObjectLinkWithObject[]>;
  }

  listByMessageAndRole(input: {
    messageId: string;
    role: MessageObjectRole;
    partition: MessageObjectPartition;
  }): Promise<MessageObjectLinkWithObject[]> {
    return this.prisma.messageObjectLink.findMany({
      where: {
        messageId: input.messageId,
        role: input.role,
        message: { conversationId: input.partition.conversationId, deletedAt: null },
        object: {
          userId: input.partition.userId,
          agentId: input.partition.agentId,
          conversationId: input.partition.conversationId,
          visibility: 'user_visible',
          status: 'available',
          deletedAt: null,
        },
      },
      include: {
        object: true,
        message: {
          select: { role: true, conversationId: true },
        },
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    }) as Promise<MessageObjectLinkWithObject[]>;
  }
}
