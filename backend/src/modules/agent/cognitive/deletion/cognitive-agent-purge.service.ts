import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Cron,
  CronExpression,
} from '@nestjs/schedule';
import {
  SeekmoreEntityType,
  Prisma,
} from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';

import { PrismaService } from '../../../../../prisma/prisma.service';

interface CognitiveAgentPurgeCandidate {
  id: string;
  userId: string | null;
  conversations: Array<{
    id: string;
    messageCount: number;
  }>;
  runtimeObjects: Array<{
    id: string;
    storageKey: string;
  }>;
  packageStorageKeys: string[];
}

export interface CognitiveAgentPurgeResult {
  id: string;
  permanentlyDeleted: true;
  conversationCount: number;
  messageCount: number;
  runtimeObjectCount: number;
}

@Injectable()
export class CognitiveAgentPurgeService {
  private readonly logger = new Logger(
    CognitiveAgentPurgeService.name,
  );

  private readonly agentStorageRoot = path.resolve(
    process.env.AGENT_STORAGE_DIR ||
      path.join(process.cwd(), 'storage', 'agents'),
  );

  private readonly objectStorageRoot = path.resolve(
    process.env.OBJECT_STORAGE_ROOT ||
      path.join(process.cwd(), 'storage', 'objects'),
  );

  private readonly projectStorageRoot = path.resolve(
    process.cwd(),
    'storage',
  );

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredAgents(): Promise<void> {
    const candidates = await this.prisma.agent.findMany({
      where: {
        entityType: SeekmoreEntityType.COGNITIVE,
        deletedAt: { not: null },
        purgeAfter: { lte: new Date() },
      },
      select: { id: true },
      orderBy: { purgeAfter: 'asc' },
      take: 30,
    });

    for (const candidate of candidates) {
      try {
        const result = await this.permanentlyDeleteExpired(
          candidate.id,
        );

        if (result) {
          this.logger.log(
            `Permanently deleted expired cognitive agent ${candidate.id}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to permanently delete cognitive agent ${candidate.id}`,
          error instanceof Error
            ? error.stack
            : String(error),
        );
      }
    }
  }

  async permanentlyDeleteOwned(
    userId: string,
    agentId: string,
  ): Promise<CognitiveAgentPurgeResult> {
    const guard: Prisma.AgentWhereInput = {
      userId,
      entityType: SeekmoreEntityType.COGNITIVE,
      deletedAt: { not: null },
    };

    const candidate = await this.loadCandidate({
      id: agentId,
      ...guard,
    });

    if (!candidate) {
      throw new NotFoundException({
        code: 'COGNITIVE_AGENT_DELETED_NOT_FOUND',
        message: 'COGNITIVE_AGENT_DELETED_NOT_FOUND',
      });
    }

    const deleted = await this.deleteDatabaseRecords(
      agentId,
      guard,
    );

    if (!deleted) {
      throw new NotFoundException({
        code: 'COGNITIVE_AGENT_DELETED_NOT_FOUND',
        message: 'COGNITIVE_AGENT_DELETED_NOT_FOUND',
      });
    }

    await this.removeStorage(candidate);

    this.logger.warn(
      `User ${userId} permanently deleted cognitive agent ${agentId}`,
    );

    return this.result(candidate);
  }

  private async permanentlyDeleteExpired(
    agentId: string,
  ): Promise<CognitiveAgentPurgeResult | null> {
    const guard: Prisma.AgentWhereInput = {
      entityType: SeekmoreEntityType.COGNITIVE,
      deletedAt: { not: null },
      purgeAfter: { lte: new Date() },
    };

    const candidate = await this.loadCandidate({
      id: agentId,
      ...guard,
    });

    if (!candidate) return null;

    const deleted = await this.deleteDatabaseRecords(
      agentId,
      guard,
    );

    if (!deleted) return null;

    await this.removeStorage(candidate);
    return this.result(candidate);
  }

  private async loadCandidate(
    where: Prisma.AgentWhereInput,
  ): Promise<CognitiveAgentPurgeCandidate | null> {
    const agent = await this.prisma.agent.findFirst({
      where,
      select: {
        id: true,
        userId: true,
        conversations: {
          select: {
            id: true,
            _count: {
              select: { messages: true },
            },
          },
        },
        runtimeObjects: {
          select: {
            id: true,
            storageKey: true,
          },
        },
      },
    });

    if (!agent) return null;

    const conversationIds = agent.conversations.map(
      (conversation) => conversation.id,
    );

    const packageArtifacts =
      await this.prisma.packageArtifact.findMany({
        where: {
          OR: [
            { agentId: agent.id },
            ...(conversationIds.length > 0
              ? [
                  {
                    conversationId: {
                      in: conversationIds,
                    },
                  },
                ]
              : []),
          ],
        },
        select: { storageKey: true },
      });

    return {
      id: agent.id,
      userId: agent.userId,
      conversations: agent.conversations.map(
        (conversation) => ({
          id: conversation.id,
          messageCount: conversation._count.messages,
        }),
      ),
      runtimeObjects: agent.runtimeObjects,
      packageStorageKeys: packageArtifacts.map(
        (artifact) => artifact.storageKey,
      ),
    };
  }

  private async deleteDatabaseRecords(
    agentId: string,
    guard: Prisma.AgentWhereInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const candidate = await tx.agent.findFirst({
          where: {
            AND: [
              { id: agentId },
              guard,
            ],
          },
          select: {
            id: true,
            conversations: {
              select: { id: true },
            },
          },
        });

        if (!candidate) return false;

        const conversationIds =
          candidate.conversations.map(
            (conversation) => conversation.id,
          );
        const conversationFilter = {
          in:
            conversationIds.length > 0
              ? conversationIds
              : ['__none__'],
        };

        await tx.workflowRun.deleteMany({
          where: { agentId },
        });
        await tx.agentTurn.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
            ],
          },
        });
        await tx.runtimeObject.deleteMany({
          where: { agentId },
        });

        await tx.codePatchRun.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
            ],
          },
        });
        await tx.packageArtifact.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
            ],
          },
        });
        await tx.codeProjectProfile.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
            ],
          },
        });

        await tx.conversationDigest.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
            ],
          },
        });
        await tx.runtimeWorkspace.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
            ],
          },
        });
        await tx.memoryAudit.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
            ],
          },
        });
        await tx.memoryEpisode.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
              {
                sourceConversationId:
                  conversationFilter,
              },
            ],
          },
        });
        await tx.memoryFact.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
              {
                sourceConversationId:
                  conversationFilter,
              },
            ],
          },
        });

        await tx.mcpToolInvocation.deleteMany({
          where: { agentId },
        });
        await tx.mcpAuditLog.deleteMany({
          where: { agentId },
        });
        await tx.mcpConnectionState.deleteMany({
          where: { agentId },
        });
        await tx.mcpOAuthState.deleteMany({
          where: { agentId },
        });
        await tx.mcpAuthSession.deleteMany({
          where: { agentId },
        });

        await tx.skillUsageEvent.deleteMany({
          where: {
            OR: [
              { agentId },
              { conversationId: conversationFilter },
            ],
          },
        });

        if (conversationIds.length > 0) {
          await tx.conversation.deleteMany({
            where: {
              id: { in: conversationIds },
            },
          });
        }

        await tx.userAgent.deleteMany({
          where: { agentId },
        });
        await tx.agentKnowledgeObject.deleteMany({
          where: { agentId },
        });
        await tx.cognitiveAgentSkillBinding.deleteMany({
          where: { cognitiveAgentId: agentId },
        });
        await tx.cognitiveAgentSkillPolicy.deleteMany({
          where: { agentId },
        });

        await tx.agent.delete({
          where: { id: agentId },
        });

        return true;
      },
      { timeout: 30_000 },
    );
  }

  private result(
    candidate: CognitiveAgentPurgeCandidate,
  ): CognitiveAgentPurgeResult {
    return {
      id: candidate.id,
      permanentlyDeleted: true,
      conversationCount:
        candidate.conversations.length,
      messageCount: candidate.conversations.reduce(
        (total, conversation) =>
          total + conversation.messageCount,
        0,
      ),
      runtimeObjectCount:
        candidate.runtimeObjects.length,
    };
  }

  private async removeStorage(
    candidate: CognitiveAgentPurgeCandidate,
  ): Promise<void> {
    const removals: Array<Promise<void>> =
      candidate.packageStorageKeys.map(
        (storageKey) =>
          this.removeProjectStorageKey(storageKey),
      );

    if (candidate.userId) {
      removals.push(
        this.removePartition(
          this.agentStorageRoot,
          candidate.userId,
          candidate.id,
        ),
        this.removePartition(
          this.objectStorageRoot,
          candidate.userId,
          candidate.id,
        ),
      );
    }

    const results = await Promise.allSettled(removals);
    const failures = results.filter(
      (result) => result.status === 'rejected',
    );

    if (failures.length > 0) {
      this.logger.error(
        `Agent ${candidate.id} database rows were deleted, but ${failures.length} storage cleanup operation(s) failed`,
      );
    }
  }

  private async removePartition(
    root: string,
    userId: string,
    agentId: string,
  ): Promise<void> {
    const target = path.resolve(
      root,
      this.safePart(userId),
      this.safePart(agentId),
    );

    if (
      target === root ||
      !target.startsWith(`${root}${path.sep}`)
    ) {
      throw new Error(
        'AGENT_PURGE_STORAGE_PATH_INVALID',
      );
    }

    await fs.rm(target, {
      recursive: true,
      force: true,
    });
  }

  private async removeProjectStorageKey(
    storageKey: string,
  ): Promise<void> {
    const target = path.resolve(
      process.cwd(),
      String(storageKey ?? ''),
    );

    if (
      target === this.projectStorageRoot ||
      !target.startsWith(
        `${this.projectStorageRoot}${path.sep}`,
      )
    ) {
      return;
    }

    await fs.rm(target, {
      recursive: true,
      force: true,
    });
  }

  private safePart(value: string): string {
    const normalized = String(value ?? '')
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|\u0000]/g, '_')
      .trim()
      .slice(0, 160);

    if (
      !normalized ||
      normalized === '.' ||
      normalized === '..'
    ) {
      throw new Error(
        'AGENT_PURGE_STORAGE_PARTITION_INVALID',
      );
    }

    return normalized;
  }
}
