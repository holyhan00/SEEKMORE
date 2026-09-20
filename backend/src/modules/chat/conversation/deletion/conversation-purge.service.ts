import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Cron,
  CronExpression,
} from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../../prisma/prisma.service';
import { StorageDeletionTaskService } from './storage-deletion-task.service';

@Injectable()
export class ConversationPurgeService {
  private readonly logger = new Logger(
    ConversationPurgeService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageDeletion: StorageDeletionTaskService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredConversations(): Promise<void> {
    const candidates = await this.prisma.conversation.findMany({
      where: {
        deletedAt: { not: null },
        purgeAfter: { lte: new Date() },
      },
      select: { id: true },
      orderBy: { purgeAfter: 'asc' },
      take: 50,
    });

    for (const candidate of candidates) {
      try {
        await this.permanentlyDelete(
          candidate.id,
          {
            deletedAt: { not: null },
            purgeAfter: { lte: new Date() },
          },
          'expired',
        );
      } catch (error) {
        this.logger.error(
          `Failed to permanently delete conversation ${candidate.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  async permanentlyDeleteOwned(
    userId: string,
    conversationId: string,
  ): Promise<{
    id: string;
    permanentlyDeleted: true;
  }> {
    const normalizedUserId = String(userId ?? '').trim();
    const normalizedConversationId = String(conversationId ?? '').trim();
    if (!normalizedUserId || !normalizedConversationId) {
      throw new NotFoundException({ code: 'CONVERSATION_DELETED_NOT_FOUND', message: 'CONVERSATION_DELETED_NOT_FOUND' });
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: normalizedConversationId,
        userId: normalizedUserId,
      },
      select: {
        id: true,
        deletedAt: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'CONVERSATION_NOT_FOUND' });
    }
    if (!conversation.deletedAt) {
      throw new BadRequestException({ code: 'CONVERSATION_NOT_IN_RECYCLE_BIN', message: 'CONVERSATION_NOT_IN_RECYCLE_BIN' });
    }

    const deleted = await this.permanentlyDelete(
      normalizedConversationId,
      {
        userId: normalizedUserId,
        deletedAt: { not: null },
      },
      'manual',
    );

    if (!deleted) {
      throw new NotFoundException({ code: 'CONVERSATION_DELETED_NOT_FOUND', message: 'CONVERSATION_DELETED_NOT_FOUND' });
    }

    return {
      id: normalizedConversationId,
      permanentlyDeleted: true,
    };
  }

  private async permanentlyDelete(
    conversationId: string,
    guard: Prisma.ConversationWhereInput,
    reason: 'expired' | 'manual',
  ): Promise<boolean> {
    const deleted = await this.deleteDatabaseRecords(
      conversationId,
      guard,
    );

    if (!deleted) return false;

    await this.storageDeletion.processSource(
      'conversation',
      conversationId,
    ).catch((error) => {
      this.logger.error(
        `Immediate storage cleanup failed for conversation ${conversationId}; retry task retained`,
        error instanceof Error ? error.stack : String(error),
      );
    });

    this.logger.log(
      `Permanently deleted ${reason} conversation ${conversationId}`,
    );
    return true;
  }

  private async deleteDatabaseRecords(
    conversationId: string,
    guard: Prisma.ConversationWhereInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const candidate = await tx.conversation.findFirst({
          where: {
            AND: [
              { id: conversationId },
              guard,
            ],
          },
          select: {
            id: true,
            userId: true,
            agentId: true,
          },
        });

        if (!candidate) return false;

        const runtimeObjects = await tx.runtimeObject.findMany({
          where: { conversationId },
          select: {
            id: true,
            storageKey: true,
          },
        });
        const runtimeObjectIds = runtimeObjects.map(
          (object) => object.id,
        );

        const externalLinks = runtimeObjectIds.length > 0
          ? await tx.messageObjectLink.findMany({
              where: {
                objectId: { in: runtimeObjectIds },
                message: {
                  conversationId: { not: conversationId },
                  deletedAt: null,
                },
              },
              select: {
                objectId: true,
                message: {
                  select: {
                    conversationId: true,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            })
          : [];

        const targetConversationIds = [...new Set(
          externalLinks.map((link) =>
            String(link.message.conversationId),
          ),
        )];
        const now = new Date();
        const targetConversations = targetConversationIds.length > 0
          ? await tx.conversation.findMany({
              where: {
                id: { in: targetConversationIds },
                userId: candidate.userId,
                OR: [
                  { deletedAt: null },
                  {
                    deletedAt: { not: null },
                    OR: [
                      { purgeAfter: null },
                      { purgeAfter: { gt: now } },
                    ],
                  },
                ],
              },
              select: {
                id: true,
                agentId: true,
              },
            })
          : [];

        const targetById = new Map(
          targetConversations.map((conversation) => [
            conversation.id,
            conversation,
          ]),
        );
        const rehomeByObjectId = new Map<
          string,
          { conversationId: string; agentId: string }
        >();

        for (const link of externalLinks) {
          const objectId = String(link.objectId);
          if (rehomeByObjectId.has(objectId)) continue;
          const target = targetById.get(
            String(link.message.conversationId),
          );
          if (!target) continue;
          rehomeByObjectId.set(objectId, {
            conversationId: target.id,
            agentId: target.agentId,
          });
        }

        for (const [objectId, target] of rehomeByObjectId) {
          await tx.runtimeObject.updateMany({
            where: {
              id: objectId,
              conversationId,
            },
            data: {
              conversationId: target.conversationId,
              agentId: target.agentId,
            },
          });
        }

        const deletedObjectIds = new Set(
          runtimeObjectIds.filter(
            (objectId) => !rehomeByObjectId.has(objectId),
          ),
        );
        const packageArtifacts = await tx.packageArtifact.findMany({
          where: { conversationId },
          select: { storageKey: true },
        });

        await this.storageDeletion.enqueueInTransaction(
          tx,
          [
            ...runtimeObjects
              .filter((object) => deletedObjectIds.has(object.id))
              .map((object) => ({
                storageKind: 'runtime_object' as const,
                storageKey: object.storageKey,
                sourceType: 'conversation',
                sourceId: conversationId,
              })),
            ...packageArtifacts.map((artifact) => ({
              storageKind: 'project_storage' as const,
              storageKey: artifact.storageKey,
              sourceType: 'conversation',
              sourceId: conversationId,
            })),
            {
              storageKind: 'presentation_storage' as const,
              storageKey: [
                this.presentationStorageSegment(candidate.userId),
                this.presentationStorageSegment(candidate.agentId),
                this.presentationStorageSegment(conversationId),
              ].join('/'),
              sourceType: 'conversation',
              sourceId: conversationId,
            },
          ],
        );

        const remainingWorkflowIds = (
          await tx.workflowRun.findMany({
            where: { conversationId },
            select: { id: true },
          })
        ).map((workflow) => workflow.id);

        if (remainingWorkflowIds.length > 0) {
          await tx.runtimeEventOutbox.deleteMany({
            where: {
              aggregateType: 'seekmore_workflow',
              aggregateId: { in: remainingWorkflowIds },
            },
          });
          await tx.workflowRun.deleteMany({
            where: { conversationId },
          });
        }

        await (tx as any).agentApproval.deleteMany({
          where: { conversationId },
        });
        await (tx as any).runtimeTimelineEvent.deleteMany({
          where: { conversationId },
        });
        await (tx as any).conversationRuntimeSetting.deleteMany({
          where: { conversationId },
        });
        await tx.chatTurnRequest.deleteMany({
          where: { conversationId },
        });
        await tx.agentTurn.deleteMany({
          where: { conversationId },
        });
        if (deletedObjectIds.size > 0) {
          await tx.runtimeObject.deleteMany({
            where: {
              id: { in: [...deletedObjectIds] },
              conversationId,
            },
          });
        }

        await tx.codePatchRun.deleteMany({
          where: { conversationId },
        });
        await tx.packageArtifact.deleteMany({
          where: { conversationId },
        });
        await tx.codeProjectProfile.deleteMany({
          where: { conversationId },
        });
        await tx.conversationDigest.deleteMany({
          where: { conversationId },
        });
        await tx.runtimeWorkspace.deleteMany({
          where: { conversationId },
        });
        await tx.memoryAudit.deleteMany({
          where: { conversationId },
        });
        await tx.memoryEpisode.deleteMany({
          where: {
            OR: [
              { conversationId },
              { sourceConversationId: conversationId },
            ],
          },
        });
        await tx.memoryFact.deleteMany({
          where: {
            OR: [
              { conversationId },
              { sourceConversationId: conversationId },
            ],
          },
        });
        await tx.skillUsageEvent.deleteMany({
          where: { conversationId },
        });

        await tx.messageObjectLink.deleteMany({
          where: {
            message: { conversationId },
          },
        });
        await tx.message.deleteMany({
          where: { conversationId },
        });
        await tx.conversation.delete({
          where: { id: conversationId },
        });

        return true;
      },
      { timeout: 30_000 },
    );
  }
  private presentationStorageSegment(value: string): string {
    return Buffer.from(String(value ?? '').trim(), 'utf8').toString('base64url');
  }

}
