                                                  
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../../../../prisma/prisma.service';
import { appError } from '../../../common/errors/app-error';
import { Prisma } from '@prisma/client';
import { SystemAgentService } from '../system/systemagent.service';
import { resolveBuiltinAssetUrl } from '../../../common/assets/builtin-asset';

@Injectable()
export class AgentService {
  private readonly storageRoot = path.resolve(
    process.env.AGENT_STORAGE_DIR || path.join(process.cwd(), 'storage', 'agents'),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemAgentService: SystemAgentService,
  ) {}

  private assetUrl(
    agentId: string,
    key: string | null | undefined,
    kind: 'avatar' | 'cover',
  ): string | null {
    if (!key) return null;

    const builtinUrl =
      resolveBuiltinAssetUrl(key);

    if (builtinUrl) {
      return builtinUrl;
    }

    return `/api/agent/${encodeURIComponent(agentId)}/profile/${kind}`;
  }

  private withAssetUrls<T extends { id: string; avatarKey?: string | null; coverKey?: string | null }>(
    agent: T,
  ) {
    return {
      ...agent,
      avatarUrl: this.assetUrl(agent.id, agent.avatarKey, 'avatar'),
      coverUrl: this.assetUrl(agent.id, agent.coverKey, 'cover'),
    };
  }

  async getProfileImage(
    userId: string,
    agentId: string,
    kind: 'avatar' | 'cover',
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        OR: [
          { userId },
          {
            userAgents: {
              some: {
                userId,
                deletedAt: null,
              },
            },
          },
          {
            visibility: {
              in: ['PUBLIC_FREE', 'PUBLIC_PAID'],
            },
            isActive: true,
            approved: true,
            deletedAt: null,
          },
        ],
      },
      select: {
        avatarKey: true,
        coverKey: true,
      },
    });

    if (!agent) {
      throw new NotFoundException({ code: 'AGENT_NOT_FOUND', message: 'Agent not found' });
    }

    const storageKey =
      kind === 'avatar'
        ? agent.avatarKey
        : agent.coverKey;

    const absolutePath =
      this.resolveProfileStoragePath(storageKey);

    if (!absolutePath) {
      throw new NotFoundException({ code: 'AGENT_PROFILE_IMAGE_NOT_FOUND', message: 'Profile image not found' });
    }

    try {
      return {
        buffer: await fs.readFile(absolutePath),
        mimeType: this.profileImageMimeType(absolutePath),
      };
    } catch {
      throw new NotFoundException({ code: 'AGENT_PROFILE_IMAGE_NOT_FOUND', message: 'Profile image not found' });
    }
  }

  private resolveProfileStoragePath(
    storageKey?: string | null,
  ): string | null {
    const normalized = String(storageKey ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const prefix = 'storage/agents/';

    if (!normalized.startsWith(prefix)) {
      return null;
    }

    const relative = normalized.slice(prefix.length);
    const absolute = path.resolve(this.storageRoot, relative);
    const rootPrefix = `${this.storageRoot}${path.sep}`;

    if (
      absolute !== this.storageRoot
      && !absolute.startsWith(rootPrefix)
    ) {
      return null;
    }

    return absolute;
  }

  private profileImageMimeType(
    absolutePath: string,
  ): string {
    switch (path.extname(absolutePath).toLowerCase()) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.webp':
        return 'image/webp';
      case '.png':
      default:
        return 'image/png';
    }
  }

  async getAllForPanel(userId: string) {
    await this.systemAgentService
      .ensureDefaultSystemAgentForUser(userId);

    return this._queryPanelAgents(userId);
  }

  private async _queryPanelAgents(userId: string) {
    const uas = await this.prisma.userAgent.findMany({
      where: {
        userId,
        deletedAt: null,
        removedFromChatAt: null,
      },
      orderBy: [
        { isDefaultAgent: 'desc' },
        { pinnedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        agentId: true,
        accessLevel: true,
        remark: true,
        pinnedAt: true,
        removedFromChatAt: true,
        isDefaultAgent: true,
        agent: {
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
            avatarKey: true,
            avatarUpdatedAt: true,
            coverKey: true,
            coverUpdatedAt: true,
            isSuper: true,
            visibility: true,
            isActive: true,
            approved: true,
            deletedAt: true,
          },
        },
      },
    });

    return uas
      .filter((x) => x.agent?.deletedAt == null && x.agent?.isActive && x.agent?.approved)
      .map((x) =>
        this.withAssetUrls({
          id: x.agentId,
          key: x.agent!.key,
          name: x.agent!.name,
          description: x.agent!.description,
          avatarKey: x.agent!.avatarKey,
          avatarUpdatedAt: x.agent!.avatarUpdatedAt,
          coverKey: x.agent!.coverKey,
          coverUpdatedAt: x.agent!.coverUpdatedAt,
          isSuper: x.agent!.isSuper,
          visibility: x.agent!.visibility,
          accessLevel: x.accessLevel,
          remark: x.remark,
          pinnedAt: x.pinnedAt?.getTime() ?? null,
          isDefaultAgent: x.isDefaultAgent,
        }),
      );
  }

  async getAccessibleAgents(userId: string) {
    return this.getAllForPanel(userId);
  }

  async listPublicAgents(params: {
    userId?: string;
    keyword?: string;
    cursor?: string;
    limit?: number;
    sort?: 'latest' | 'updated' | 'hot';
  }) {
    const { userId, keyword, cursor, limit = 20, sort = 'updated' } = params;

    const where: any = {
      visibility: { in: ['PUBLIC_FREE', 'PUBLIC_PAID'] },
      isActive: true,
      approved: true,
      deletedAt: null,
    };

    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        { tags: { hasSome: [keyword] } },
      ];
    }

    let orderBy: any = { updatedAt: 'desc' };
    if (sort === 'latest') orderBy = { createdAt: 'desc' };
    if (sort === 'hot') orderBy = { downloads: 'desc' };

    const items = await this.prisma.agent.findMany({
      where,
      orderBy,
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      select: {
        id: true,
        name: true,
        description: true,
        avatarKey: true,
        avatarUpdatedAt: true,
        coverKey: true,
        coverUpdatedAt: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
        downloads: true,
        likes: true,
        tags: true,
        userId: true,
      },
    });

    const ids = items.map((i) => i.id);
    const myMap = new Map<string, string | null>();

    if (userId) {
      const uas = await this.prisma.userAgent.findMany({
        where: { userId, agentId: { in: ids }, deletedAt: null },
        select: { agentId: true, accessLevel: true },
      });
      uas.forEach((u) => myMap.set(u.agentId, u.accessLevel));
    }

    const list = items.slice(0, limit).map((a) =>
      this.withAssetUrls({
        ...a,
        myAccess: myMap.get(a.id) ?? null,
      }),
    );

    const nextCursor = items.length > limit ? items[limit].id : null;

    return { list, nextCursor };
  }

  async getPublicAgentDetail(agentId: string, userId?: string) {
    const a = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        visibility: { in: ['PUBLIC_FREE', 'PUBLIC_PAID'] },
        isActive: true,
        approved: true,
        deletedAt: null,
      },
    });

    if (!a) throw new NotFoundException({ code: 'PUBLIC_AGENT_NOT_FOUND', message: 'Agent not found or not public' });

    let myAccess: string | null = null;

    if (userId) {
      const ua = await this.prisma.userAgent.findFirst({
        where: { userId, agentId, deletedAt: null },
        select: { accessLevel: true },
      });
      myAccess = ua?.accessLevel ?? null;
    }

    return this.withAssetUrls({ ...a, myAccess });
  }

  async claimPublicFreeAgent(agentId: string, userId: string) {
    const source = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        visibility: 'PUBLIC_FREE',
        isActive: true,
        approved: true,
        deletedAt: null,
      },
    });
    if (!source) throw new NotFoundException({ code: 'PUBLIC_FREE_AGENT_NOT_FOUND', message: 'Public free agent not found' });

    const existing = await this.prisma.userAgent.findUnique({
      where: { agentId_userId: { agentId, userId } },
    });
    const relation = await this.prisma.$transaction(async (tx) => {
      const joined = await tx.userAgent.upsert({
        where: { agentId_userId: { agentId, userId } },
        create: { userId, agentId, accessLevel: 'VIEWER' },
        update: {
          accessLevel: 'VIEWER',
          deletedAt: null,
          removedFromChatAt: null,
        },
        include: { agent: true },
      });
      if (!existing || existing.deletedAt) {
        await tx.agent.update({ where: { id: agentId }, data: { downloads: { increment: 1 } } });
      }
      return joined;
    });
    return this.withAssetUrls({
      ...relation.agent,
      accessLevel: relation.accessLevel,
    });
  }

  async authorizePaidAgent(agentId: string, userId: string) {
    const paid = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        visibility: 'PUBLIC_PAID',
        isActive: true,
        approved: true,
        deletedAt: null,
      },
    });

    if (!paid) throw new NotFoundException({ code: 'PUBLIC_PAID_AGENT_NOT_FOUND', message: 'Public paid agent not found' });

    return this.prisma.userAgent.upsert({
      where: { agentId_userId: { agentId, userId } },
      create: {
        userId,
        agentId,
        accessLevel: 'EDITOR',
        removedFromChatAt: null,
      },
      update: {
        accessLevel: 'EDITOR',
        deletedAt: null,
        removedFromChatAt: null,
      },
    });
  }

  async setRemark(userId: string, agentId: string, remark: string) {
    const ua = await this.prisma.userAgent.findUnique({
      where: { agentId_userId: { agentId, userId } },
    });

    if (!ua || ua.deletedAt) throw new NotFoundException({ code: 'AGENT_RELATION_NOT_FOUND', message: 'Relation not found' });

    await this.prisma.userAgent.update({
      where: { agentId_userId: { agentId, userId } },
      data: { remark },
    });

    return { ok: true };
  }

  async pin(userId: string, agentId: string, pinned: boolean) {
    const ua = await this.prisma.userAgent.findUnique({
      where: { agentId_userId: { agentId, userId } },
    });

    if (!ua || ua.deletedAt) throw new NotFoundException({ code: 'AGENT_RELATION_NOT_FOUND', message: 'Relation not found' });

    await this.prisma.userAgent.update({
      where: { agentId_userId: { agentId, userId } },
      data: { pinnedAt: pinned ? new Date() : null },
    });

    return { ok: true, pinned };
  }

  async removeFromChat(userId: string, agentId: string) {
    const ua = await this.prisma.userAgent.findUnique({
      where: { agentId_userId: { agentId, userId } },
      include: {
        agent: {
          select: {
            isSuper: true,
            key: true,
          },
        },
      },
    });

    if (!ua || ua.deletedAt) throw new NotFoundException({ code: 'AGENT_RELATION_NOT_FOUND', message: 'Relation not found' });

    const isSystemAgent =
      ua.agent?.isSuper === true
      || ua.isDefaultAgent;

    if (isSystemAgent) {
      throw new ForbiddenException(
        appError('SYSTEM_AGENT_REMOVE_FORBIDDEN'),
      );
    }

    await this.prisma.userAgent.update({
      where: { agentId_userId: { agentId, userId } },
      data: {
        removedFromChatAt: new Date(),
        pinnedAt: null,
      },
    });

    return { ok: true };
  }

  async restoreToChat(userId: string, agentId: string) {
    const ua = await this.prisma.userAgent.findUnique({
      where: { agentId_userId: { agentId, userId } },
      include: {
        agent: {
          select: {
            deletedAt: true,
            isActive: true,
            approved: true,
          },
        },
      },
    });

    if (!ua || ua.deletedAt) throw new NotFoundException({ code: 'AGENT_RELATION_NOT_FOUND', message: 'Relation not found' });

    if (ua.agent.deletedAt || !ua.agent.isActive || !ua.agent.approved) {
      throw new ForbiddenException({ code: 'AGENT_UNAVAILABLE', message: 'Agent unavailable' });
    }

    await this.prisma.userAgent.update({
      where: { agentId_userId: { agentId, userId } },
      data: {
        removedFromChatAt: null,
        pinnedAt: new Date(),
      },
    });

    return { ok: true };
  }

  async softDeleteUserAgent(userId: string, agentId: string) {
    const ua = await this.prisma.userAgent.findUnique({
      where: { agentId_userId: { agentId, userId } },
      include: {
        agent: {
          select: {
            isSuper: true,
            key: true,
          },
        },
      },
    });

    if (!ua || ua.deletedAt) throw new NotFoundException({ code: 'AGENT_RELATION_NOT_FOUND', message: 'Relation not found' });

    const isSystemAgent =
      ua.agent?.isSuper === true
      || ua.isDefaultAgent;

    if (isSystemAgent) {
      throw new ForbiddenException(
        appError('SYSTEM_AGENT_DELETE_FORBIDDEN'),
      );
    }

    await this.prisma.userAgent.update({
      where: { agentId_userId: { agentId, userId } },
      data: {
        deletedAt: new Date(),
        removedFromChatAt: new Date(),
        pinnedAt: null,
      },
    });

    return { ok: true };
  }
}
