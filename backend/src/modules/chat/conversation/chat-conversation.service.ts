import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { recyclePurgeAfter } from '../../../common/lifecycle/recycle-retention';
import { resolveBuiltinAssetUrl } from '../../../common/assets/builtin-asset';
import { WorkflowConversationCleanupService } from '../../seekmore-workflow/application/workflow-conversation-cleanup.service';
import { WorkflowTransactionService } from '../../seekmore-workflow/persistence/workflow-transaction.service';
import { AutomationService } from '../../automation/automation.service';

const DEFAULT_TITLE = '';

@Injectable()
export class ChatConversationService {
  private readonly logger = new Logger(
    ChatConversationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowTransactions: WorkflowTransactionService,
    private readonly workflowCleanup: WorkflowConversationCleanupService,
    private readonly automations: AutomationService,
  ) {}

  private async checkAgentAccess(
    userId: string,
    agentId: string,
  ): Promise<void> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        userId: true,
        deletedAt: true,
        isActive: true,
      },
    });

    if (!agent || agent.deletedAt || !agent.isActive) {
      throw new ForbiddenException({ code: 'AGENT_UNAVAILABLE', message: 'AGENT_UNAVAILABLE' });
    }

    if (agent.userId === userId) return;

    const access = await this.prisma.userAgent.findFirst({
      where: {
        userId,
        agentId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!access) {
      throw new ForbiddenException({ code: 'AGENT_ACCESS_DENIED', message: 'AGENT_ACCESS_DENIED' });
    }
  }

  async createNew(params: {
    userId: string;
    agentId: string;
    firstMessage?: string;
  }) {
    const { userId, agentId } = params;

    await this.checkAgentAccess(userId, agentId);

    const now = new Date();
    const conversation = await this.prisma.conversation.create({
      data: {
        userId,
        agentId,
        title: DEFAULT_TITLE,
        titleVersion: 1,
        titleUpdatedAt: now,
        messageCount: 0,
      },
      select: {
        id: true,
        title: true,
        agentId: true,
        createdAt: true,
        userId: true,
        titleVersion: true,
        titleUpdatedAt: true,
      },
    });

    this.logger.log(
      `[ConvCreate] placeholder created: conv=${conversation.id} user=${userId} agent=${agentId}`,
    );

    return conversation;
  }

  async softDelete(params: {
    userId: string;
    conversationId: string;
  }) {
    const { userId, conversationId } = params;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        userId: true,
        deletedAt: true,
        purgeAfter: true,
        agentId: true,
        agent: {
          select: {
            deletedAt: true,
            isActive: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'CONVERSATION_NOT_FOUND' });
    }
    if (conversation.userId !== userId) {
      throw new ForbiddenException({ code: 'CONVERSATION_DELETE_DENIED', message: 'CONVERSATION_DELETE_DENIED' });
    }

    if (conversation.deletedAt) {
      return {
        ok: true,
        deletedAt: conversation.deletedAt,
        purgeAfter:
          conversation.purgeAfter ??
          recyclePurgeAfter(conversation.deletedAt),
        executionResumed: false,
      };
    }

    const deletedAt = new Date();
    const purgeAfter = recyclePurgeAfter(deletedAt);

    const committed = await this.workflowTransactions.withConversationLock(
      conversationId,
      async (tx) => {
        const current = await tx.conversation.findFirst({
          where: {
            id: conversationId,
            userId,
            agentId: conversation.agentId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!current) {
          throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'CONVERSATION_NOT_FOUND' });
        }

        const cleanup = await this.workflowCleanup.deleteInTransaction(
          tx,
          {
            userId,
            agentId: conversation.agentId,
            conversationId,
          },
          deletedAt,
        );
        const automationCleanup = await this.automations.cancelByConversationInTransaction(
          tx,
          { userId, conversationId },
          deletedAt,
        );
        const updated = await tx.conversation.update({
          where: { id: conversationId },
          data: {
            deletedAt,
            purgeAfter,
            isArchived: true,
          },
          select: {
            id: true,
            deletedAt: true,
            purgeAfter: true,
          },
        });
        return { updated, cleanup, automationCleanup };
      },
    );

    await this.workflowCleanup.finalizeCleanup(committed.cleanup);
    this.automations.finalizeConversationCancellation(committed.automationCleanup);

    this.logger.log(
      `[ConvDelete] soft deleted conv=${conversationId} pausedWorkflows=${committed.cleanup.pausedWorkflowCount} blockedTurns=${committed.cleanup.blockedTurnCount} cancelledAutomations=${committed.automationCleanup.cancelledAutomationCount} disabledMemory=${committed.cleanup.disabledMemoryCount}`,
    );

    return {
      ok: true,
      deletedAt: committed.updated.deletedAt,
      purgeAfter: committed.updated.purgeAfter,
      executionResumed: false,
      pausedWorkflowCount: committed.cleanup.pausedWorkflowCount,
      blockedTurnCount: committed.cleanup.blockedTurnCount,
      cancelledApprovalCount: committed.cleanup.cancelledApprovalCount,
      disabledMemoryCount: committed.cleanup.disabledMemoryCount,
      cancelledAutomationCount: committed.automationCleanup.cancelledAutomationCount,
    };
  }

  async listRecycleGroups(userId: string) {
    const rows = await this.prisma.conversation.findMany({
      where: {
        userId,
        deletedAt: { not: null },
        agent: {
          deletedAt: null,
          isActive: true,
        },
      },
      orderBy: [
        { deletedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        title: true,
        deletedAt: true,
        purgeAfter: true,
        lastMessageAt: true,
        updatedAt: true,
        agent: {
          select: {
            id: true,
            name: true,
            avatarKey: true,
            avatarUpdatedAt: true,
            entityType: true,
            deletedAt: true,
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    const groups = new Map<
      string,
      {
        agent: {
          id: string;
          name: string;
          avatarUrl: string | null;
          entityType: string;
          status: 'ACTIVE';
        };
        conversations: Array<{
          id: string;
          title: string;
          messageCount: number;
          deletedAt: Date;
          purgeAfter: Date;
          lastMessageAt: Date | null;
        }>;
      }
    >();

    for (const row of rows) {
      const current = groups.get(row.agent.id) ?? {
        agent: {
          id: row.agent.id,
          name: row.agent.name,
          avatarUrl: this.assetUrl(
            row.agent.avatarKey,
            row.agent.avatarUpdatedAt,
          ),
          entityType: row.agent.entityType,
          status: 'ACTIVE' as const,
        },
        conversations: [],
      };

      current.conversations.push({
        id: row.id,
        title: row.title,
        messageCount: row._count.messages,
        deletedAt: row.deletedAt as Date,
        purgeAfter:
          row.purgeAfter ??
          recyclePurgeAfter(row.deletedAt as Date),
        lastMessageAt: row.lastMessageAt,
      });

      groups.set(row.agent.id, current);
    }

    return [...groups.values()];
  }

  async listRecycledMessages(
    userId: string,
    conversationId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
        deletedAt: { not: null },
        agent: { deletedAt: null, isActive: true },
      },
      select: {
        id: true,
        title: true,
        messages: {
          where: { deletedAt: null },
          orderBy: { timestamp: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            model: true,
            timestamp: true,
            objectLinks: {
              where: {
                object: {
                  userId,
                  status: 'available',
                  deletedAt: null,
                },
              },
              orderBy: [
                { role: 'asc' },
                { position: 'asc' },
                { id: 'asc' },
              ],
              select: {
                role: true,
                position: true,
                createdAt: true,
                object: {
                  select: {
                    id: true,
                    originalName: true,
                    displayName: true,
                    objectKind: true,
                    extension: true,
                    mimeType: true,
                    sizeBytes: true,
                    metadata: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException({ code: 'CONVERSATION_DELETED_NOT_FOUND', message: 'CONVERSATION_DELETED_NOT_FOUND' });
    }

    return {
      id: conversation.id,
      title: conversation.title,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        model: message.model,
        timestamp: message.timestamp,
        objects: message.objectLinks.map((link) => {
          const metadata = this.record(link.object.metadata);
          const media = this.record(metadata.media);
          const downloadUrl = `/api/objects/${encodeURIComponent(link.object.id)}/download`;
          return {
            objectId: link.object.id,
            role: link.role === 'USER_INPUT'
              ? 'user_input'
              : 'assistant_output',
            messageId: message.id,
            conversationId,
            displayName: link.object.displayName,
            originalName: link.object.originalName || undefined,
            objectKind: link.object.objectKind,
            mimeType: link.object.mimeType,
            extension: link.object.extension || undefined,
            sizeBytes: Number(link.object.sizeBytes),
            downloadUrl,
            previewUrl: ['image', 'audio'].includes(link.object.objectKind)
              ? downloadUrl
              : undefined,
            media: ['image', 'audio'].includes(link.object.objectKind)
              ? {
                  ...(this.positiveInteger(media.width)
                    ? { width: this.positiveInteger(media.width) }
                    : {}),
                  ...(this.positiveInteger(media.height)
                    ? { height: this.positiveInteger(media.height) }
                    : {}),
                  ...(this.textValue(media.format)
                    ? { format: this.textValue(media.format) }
                    : {}),
                  ...(typeof media.hasAlpha === 'boolean'
                    ? { hasAlpha: media.hasAlpha }
                    : {}),
                  ...(this.positiveNumber(media.durationMs)
                    ? { durationMs: this.positiveNumber(media.durationMs) }
                    : {}),
                  ...(this.positiveInteger(media.sampleRate)
                    ? { sampleRate: this.positiveInteger(media.sampleRate) }
                    : {}),
                  ...(this.positiveInteger(media.channels)
                    ? { channels: this.positiveInteger(media.channels) }
                    : {}),
                  ...(this.positiveInteger(media.bitrate)
                    ? { bitrate: this.positiveInteger(media.bitrate) }
                    : {}),
                  ...(this.textValue(media.codec)
                    ? { codec: this.textValue(media.codec) }
                    : {}),
                }
              : undefined,
            position: link.position,
            createdAt: link.createdAt.toISOString(),
          };
        }),
      })),
    };
  }

  async restore(params: {
    userId: string;
    conversationId: string;
  }) {
    const { userId, conversationId } = params;

    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
        deletedAt: { not: null },
      },
      select: {
        id: true,
        deletedAt: true,
        purgeAfter: true,
        agentId: true,
        agent: {
          select: {
            deletedAt: true,
            isActive: true,
          },
        },
      },
    });

    if (!conversation?.deletedAt) {
      throw new NotFoundException({ code: 'CONVERSATION_DELETED_NOT_FOUND', message: 'CONVERSATION_DELETED_NOT_FOUND' });
    }

    if (
      conversation.purgeAfter &&
      conversation.purgeAfter.getTime() <= Date.now()
    ) {
      throw new BadRequestException({
        code: 'CONVERSATION_RETENTION_EXPIRED',
        message: 'CONVERSATION_RETENTION_EXPIRED',
      });
    }

    if (
      conversation.agent.deletedAt ||
      !conversation.agent.isActive
    ) {
      throw new BadRequestException({
        code: 'CONVERSATION_AGENT_DELETED',
        message: 'CONVERSATION_AGENT_DELETED',
      });
    }

    const restored = await this.workflowTransactions.withConversationLock(
      conversationId,
      async (tx) => {
        const current = await tx.conversation.findFirst({
          where: {
            id: conversationId,
            userId,
            agentId: conversation.agentId,
            deletedAt: { not: null },
          },
          select: { id: true, deletedAt: true },
        });
        if (!current?.deletedAt) {
          throw new NotFoundException({ code: 'CONVERSATION_DELETED_NOT_FOUND', message: 'CONVERSATION_DELETED_NOT_FOUND' });
        }

        const restoredMemory = await (tx as any).memoryFact.updateMany({
          where: {
            userId,
            status: 'deleted',
            validTo: current.deletedAt,
            OR: [
              { conversationId },
              { sourceConversationId: conversationId },
            ],
          },
          data: {
            status: 'active',
            validTo: null,
          },
        });

        const continuableWorkflowCount = await (tx as any).workflowRun.count({
          where: {
            userId,
            agentId: conversation.agentId,
            conversationId,
            status: { in: ['RUNNING', 'WAITING', 'BLOCKED'] },
          },
        });

        const row = await tx.conversation.update({
          where: { id: conversationId },
          data: {
            deletedAt: null,
            purgeAfter: null,
            isArchived: false,
          },
          select: {
            id: true,
            title: true,
            agentId: true,
            updatedAt: true,
          },
        });

        return {
          ...row,
          executionResumed: false,
          continuableWorkflowCount,
          restoredMemoryCount: Number(restoredMemory.count ?? 0),
        };
      },
    );

    this.logger.log(
      `[ConvRestore] restored conv=${conversationId} workflows=${restored.continuableWorkflowCount} memory=${restored.restoredMemoryCount}`,
    );

    return restored;
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private textValue(value: unknown): string | undefined {
    const output = String(value ?? '').trim();
    return output || undefined;
  }

  private positiveInteger(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isInteger(number) && number > 0
      ? number
      : undefined;
  }

  private positiveNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? number
      : undefined;
  }

  private assetUrl(
    key?: string | null,
    updatedAt?: Date | null,
  ): string | null {
    if (!key) return null;

    const builtinUrl =
      resolveBuiltinAssetUrl(
        key,
        updatedAt,
      );

    if (builtinUrl) {
      return builtinUrl;
    }

    const normalized = key.replace(/\\/g, '/');
    const index = normalized.indexOf('storage/');
    const relative = index >= 0
      ? normalized.slice(index)
      : normalized;
    const version = updatedAt?.getTime();

    return `/${relative}${version ? `?v=${version}` : ''}`;
  }
}
