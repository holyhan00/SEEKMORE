// backend/src/modules/agent/system/systemagent.service.ts

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  AgentAccessLevel,
  AgentVisibility,
  SeekmoreEntityType,
  Prisma,
} from '@prisma/client';

import {
  PrismaService,
} from '../../../../prisma/prisma.service';
import {
  defaultSystemPrompt,
} from './defaultSystemPrompt';

type SystemAgentDatabase =
  | PrismaService
  | Prisma.TransactionClient;

@Injectable()
export class SystemAgentService
  implements OnApplicationBootstrap
{
  private readonly logger =
    new Logger(
      SystemAgentService.name,
    );

  private readonly defaultAvatarKey =
    'builtin:agents/seekmore/avatar.png';

  private readonly defaultCoverKey =
    'builtin:agents/seekmore/cover.png';

  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const systemAgent =
      await this.ensureSystemAgent(
        this.prisma,
      );

    const account =
      await this.prisma.localAccount.findUnique({
        where: {
          key: 'primary',
        },
        select: {
          userId: true,
        },
      });

    if (account?.userId) {
      await this.ensureDefaultSystemAgentForUser(
        account.userId,
      );
    }

    this.logger.log(
      `SEEKMORE system assistant is ready, agentId=${systemAgent.id}`,
    );
  }

  private getSystemAgentKey(): string {
    return (
      process.env
        .DEFAULT_SYSTEM_AGENT_KEY
        ?.trim()
      || 'seekmore-system-agent'
    );
  }

  private async ensureSystemAgent(
    db: SystemAgentDatabase,
  ): Promise<{
    id: string;
  }> {
    const agentKey =
      this.getSystemAgentKey();

    const systemPrompt =
      defaultSystemPrompt.trim();

    const select = {
      id: true,
      name: true,
      description: true,
      entityType: true,
      avatarKey: true,
      coverKey: true,
      systemPrompt: true,
      isSuper: true,
      isTemplate: true,
      visibility: true,
      isActive: true,
      approved: true,
      deletedAt: true,
      purgeAfter: true,
      userId: true,
    } as const;

    const existing =
      await db.agent.findUnique({
        where: {
          key: agentKey,
        },
        select,
      });

    if (!existing) {
      const created =
        await db.agent.create({
          data: {
            key: agentKey,
            name: 'SEEKMORE',
            description:
              'Work easy. Live easy.',
            entityType:
              SeekmoreEntityType.COGNITIVE,
            avatarKey:
              this.defaultAvatarKey,
            avatarUpdatedAt:
              new Date(),
            coverKey:
              this.defaultCoverKey,
            coverUpdatedAt:
              new Date(),
            systemPrompt,
            isSuper: true,
            isTemplate: false,
            visibility:
              AgentVisibility.PRIVATE,
            isActive: true,
            approved: true,
            deletedAt: null,
            purgeAfter: null,
            userId: null,
          },
          select: {
            id: true,
          },
        });

      this.logger.log(
        `Created SEEKMORE system assistant, key=${agentKey}`,
      );

      return created;
    }

    const requiresUpdate =
      existing.name
        !== 'SEEKMORE'
      || existing.description
        !== 'Work easy. Live easy.'
      || existing.entityType
        !== SeekmoreEntityType.COGNITIVE
      || existing.avatarKey
        !== this.defaultAvatarKey
      || existing.coverKey
        !== this.defaultCoverKey
      || existing.systemPrompt
        !== systemPrompt
      || existing.isSuper
        !== true
      || existing.isTemplate
        !== false
      || existing.visibility
        !== AgentVisibility.PRIVATE
      || existing.isActive
        !== true
      || existing.approved
        !== true
      || existing.deletedAt
        !== null
      || existing.purgeAfter
        !== null
      || existing.userId
        !== null;

    if (requiresUpdate) {
      await db.agent.update({
        where: {
          id: existing.id,
        },
        data: {
          name: 'SEEKMORE',
          description:
            'Work easy Live easy',
          entityType:
            SeekmoreEntityType.COGNITIVE,
          avatarKey:
            this.defaultAvatarKey,
          avatarUpdatedAt:
            existing.avatarKey
              === this.defaultAvatarKey
              ? undefined
              : new Date(),
          coverKey:
            this.defaultCoverKey,
          coverUpdatedAt:
            existing.coverKey
              === this.defaultCoverKey
              ? undefined
              : new Date(),
          systemPrompt,
          isSuper: true,
          isTemplate: false,
          visibility:
            AgentVisibility.PRIVATE,
          isActive: true,
          approved: true,
          deletedAt: null,
          purgeAfter: null,
          userId: null,
        },
      });

      this.logger.log(
        `Reconciled SEEKMORE system assistant, agentId=${existing.id}`,
      );
    }

    return {
      id: existing.id,
    };
  }

  async ensureDefaultSystemAgentForUser(
    userId: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<string> {
    const normalizedUserId =
      String(
        userId ?? '',
      ).trim();

    if (!normalizedUserId) {
      throw new Error(
        'ensureDefaultSystemAgentForUser: userId is required',
      );
    }

    const ensureBinding = async (
      db: SystemAgentDatabase,
    ): Promise<string> => {
      const systemAgent =
        await this.ensureSystemAgent(
          db,
        );

      const [existingBinding, otherDefault] =
        await Promise.all([
          db.userAgent.findUnique({
            where: {
              agentId_userId: {
                agentId:
                  systemAgent.id,
                userId:
                  normalizedUserId,
              },
            },
            select: {
              deletedAt: true,
              removedFromChatAt: true,
              pinnedAt: true,
              accessLevel: true,
              isDefaultAgent: true,
            },
          }),
          db.userAgent.findFirst({
            where: {
              userId:
                normalizedUserId,
              isDefaultAgent: true,
              deletedAt: null,
              agentId: {
                not:
                  systemAgent.id,
              },
            },
            select: {
              id: true,
            },
          }),
        ]);

      const bindingAlreadyCorrect =
        existingBinding
        && existingBinding.deletedAt
          === null
        && existingBinding.removedFromChatAt
          === null
        && existingBinding.accessLevel
          === AgentAccessLevel.OWNER
        && existingBinding.isDefaultAgent
          === true
        && !otherDefault;

      if (bindingAlreadyCorrect) {
        return systemAgent.id;
      }

      await db.userAgent.updateMany({
        where: {
          userId:
            normalizedUserId,
          isDefaultAgent: true,
          agentId: {
            not:
              systemAgent.id,
          },
        },
        data: {
          isDefaultAgent: false,
        },
      });

      await db.userAgent.upsert({
        where: {
          agentId_userId: {
            agentId:
              systemAgent.id,
            userId:
              normalizedUserId,
          },
        },
        create: {
          agentId:
            systemAgent.id,
          userId:
            normalizedUserId,
          accessLevel:
            AgentAccessLevel.OWNER,
          isDefaultAgent: true,
          removedFromChatAt: null,
          deletedAt: null,
          pinnedAt: new Date(),
          remark: 'SEEKMORE',
        },
        update: {
          accessLevel:
            AgentAccessLevel.OWNER,
          isDefaultAgent: true,
          removedFromChatAt: null,
          deletedAt: null,
          pinnedAt:
            existingBinding?.pinnedAt
            ?? new Date(),
          remark: 'SEEKMORE',
        },
      });

      return systemAgent.id;
    };

    if (transaction) {
      return ensureBinding(
        transaction,
      );
    }

    return this.prisma.$transaction(
      async (tx) =>
        ensureBinding(tx),
    );
  }

  async getDefaultAgentId(
    userId: string,
  ): Promise<string> {
    return this
      .ensureDefaultSystemAgentForUser(
        userId,
      );
  }
}