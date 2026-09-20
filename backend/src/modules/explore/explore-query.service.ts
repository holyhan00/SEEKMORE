import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';


@Injectable()
export class ExploreQueryService {
  private readonly db: any;
  constructor(prisma: PrismaService) {
    this.db = prisma as any;
  }

  async agents(userId: string, query?: string) {
    const rows = await this.db.agent.findMany({
      where: {
        visibility: { in: ['PUBLIC_FREE', 'PUBLIC_PAID'] },
        isActive: true,
        approved: true,
        deletedAt: null,
        ...(query ? { OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { tags: { has: query } },
        ] } : {}),
      },
      include: { userAgents: { where: { userId, deletedAt: null }, take: 1 } },
      orderBy: [{ downloads: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    return rows.map((row: any) => ({
      resourceType: 'AGENT',
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      avatarKey: row.avatarKey,
      coverKey: row.coverKey,
      tags: row.tags ?? [],
      visibility: row.visibility,
      installed: row.userAgents.length > 0,
      actionState: row.userAgents.length > 0 ? 'ADDED' : row.visibility === 'PUBLIC_PAID' ? 'AUTHORIZE' : 'ADD',
      downloads: row.downloads,
    }));
  }

  async skills(userId: string, query?: string) {
    const rows = await this.db.skill.findMany({
      where: {
        visibility: 'PUBLIC',
        status: 'ACTIVE',
        securityState: 'CLEAR',
        deletedAt: null,
        ...(query ? { OR: [
          { displayName: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { tags: { has: query } },
        ] } : {}),
      },
      include: {
        installations: {
          where: { installedByUserId: userId, scopeType: 'USER', scopeId: userId, status: 'INSTALLED', removedAt: null },
          take: 1,
        },
      },
      orderBy: [{ useCount: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    return rows.map((row: any) => ({
      resourceType: 'SKILL',
      id: row.id,
      name: row.displayName,
      description: row.description,
      iconKey: row.iconKey,
      coverKey: row.coverKey,
      tags: row.tags ?? [],
      category: row.category,
      installed: row.installations.length > 0,
      actionState: row.installations.length > 0 ? 'INSTALLED' : 'INSTALL',
      useCount: String(row.useCount ?? 0),
    }));
  }


  async featured(userId: string) {
    const [agents, skills] = await Promise.all([
      this.agents(userId),
      this.skills(userId),
    ]);

    return [
      ...agents.slice(0, 2),
      ...skills.slice(0, 2),
    ];
  }

  async popular(userId: string) {
    const [agents, skills] = await Promise.all([
      this.agents(userId),
      this.skills(userId),
    ]);

    return [
      ...agents.slice(0, 6),
      ...skills.slice(0, 6),
    ];
  }
}
