                                                                                  

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class WorkflowTransactionService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  withTransaction<T>(
    work: (
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      (tx) => work(tx),
      {
        timeout: 30_000,
      },
    );
  }

  withConversationLock<T>(
    conversationId: string,
    work: (
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    const normalizedConversationId =
      conversationId.trim();

    if (!normalizedConversationId) {
      throw new Error(
        'WORKFLOW_CONVERSATION_ID_REQUIRED',
      );
    }

    const lockKey =
      `seekmore-workflow:conversation:${normalizedConversationId}`;

    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ acquired: number }>
        >`
          SELECT 1::int AS "acquired"
          FROM (
            SELECT pg_advisory_xact_lock(
              hashtextextended(
                ${lockKey},
                0
              )
            )
          ) AS workflow_lock
        `;

        if (
          rows.length !== 1 ||
          rows[0]?.acquired !== 1
        ) {
          throw new Error(
            'WORKFLOW_CONVERSATION_LOCK_NOT_ACQUIRED',
          );
        }

        return work(tx);
      },
      {
        timeout: 30_000,
      },
    );
  }

  client(): PrismaService {
    return this.prisma;
  }
}