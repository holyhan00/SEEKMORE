                                                                     

import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SkillInstallationStatus,
  SkillPrincipalType,
  SkillSourceKind,
  SkillStatus,
} from '@prisma/client';

import type { SkillListQueryDto } from '../api/dto/skill.dto';
import { toSkillApiJson } from '../domain/skill-json.util';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillAccessService } from './skill-access.service';
import { SkillDeletionPolicyService } from './skill-deletion-policy.service';
import { resolveBuiltinAssetUrl } from '../../../../common/assets/builtin-asset';

@Injectable()
export class SkillQueryService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly deletionPolicy: SkillDeletionPolicyService,
  ) {}

  async list(
    userId: string,
    query: SkillListQueryDto,
  ) {
    const filters: Prisma.SkillWhereInput[] = [];
    const search = String(
      query.search ?? '',
    ).trim();

    if (search) {
      filters.push({
        OR: [
          {
            displayName: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            tags: {
              has: search,
            },
          },
        ],
      });
    }

    if (
      query.status &&
      Object.values(SkillStatus).includes(
        query.status as SkillStatus,
      )
    ) {
      filters.push({
        status: query.status as SkillStatus,
      });
    }

    if (query.category) {
      filters.push({
        category: query.category,
      });
    }

    if (
      query.sourceKind &&
      Object.values(SkillSourceKind).includes(
        query.sourceKind as SkillSourceKind,
      )
    ) {
      filters.push({
        source: {
          is: {
            kind: query.sourceKind as SkillSourceKind,
          },
        },
      });
    }

    const scope = query.scope ?? 'mine';

    if (scope !== 'deleted') {
      const officialInstallation: Prisma.SkillWhereInput = {
        source: {
          is: {
            kind: SkillSourceKind.BUILTIN,
          },
        },
        installations: {
          some: {
            scopeType:
              SkillPrincipalType.USER,
            scopeId: userId,
            status: {
              not: SkillInstallationStatus.UNINSTALLED,
            },
            enabled: true,
            removedAt: null,
          },
        },
      };

      if (scope === 'drafts') {
        filters.push({
          ownerUserId: userId,
          status: {
            in: [
              SkillStatus.DRAFT,
              SkillStatus.REJECTED,
            ],
          },
        });
      } else {
        filters.push({
          OR: [
            {
              ownerUserId: userId,
            },
            officialInstallation,
          ],
        });

        filters.push({
          status:
            scope === 'archived'
              ? SkillStatus.ARCHIVED
              : {
                  notIn: [
                    SkillStatus.DRAFT,
                    SkillStatus.REJECTED,
                    SkillStatus.ARCHIVED,
                  ],
                },
        });
      }
    }

    const where: Prisma.SkillWhereInput =
      filters.length > 0
        ? {
            AND: filters,
          }
        : {};

    const limit = Math.max(
      1,
      Math.min(
        Number(query.limit ?? 20),
        100,
      ),
    );

    const offset = Math.max(
      0,
      Number(query.offset ?? 0),
    );

    const [items, total] =
      scope === 'deleted'
        ? await this.repository.listDeletedOwned(
            userId,
            where,
            offset,
            limit,
          )
        : await this.repository.listAccessible(
            userId,
            where,
            offset,
            limit,
          );

    return toSkillApiJson({
      items: items.map((item) =>
        this.map(item),
      ),
      total,
      limit,
      offset,
    });
  }

  async detail(
    userId: string,
    skillId: string,
  ) {
    await this.access.readable(
      userId,
      skillId,
    );

    const [manageable, deletion] =
      await Promise.all([
        this.repository.findManageableSkill(
          userId,
          skillId,
        ),
        this.deletionPolicy.evaluate(
          userId,
          skillId,
        ),
      ]);

    const skill =
      await this.repository.client().skill.findUnique({
        where: {
          id: skillId,
        },
        include: {
          currentVersion: true,
          source: true,

          createdBy: {
            select: {
              id: true,
              username: true,
            },
          },

          versions: {
            orderBy: {
              versionNumber: 'desc',
            },
            include: {
              _count: {
                select: {
                  files: true,
                },
              },
            },
          },

          installations: {
            where: {
              scopeType:
                SkillPrincipalType.USER,
              scopeId: userId,
              removedAt: null,
            },
            take: 1,
          },

          _count: {
            select: {
              agentBindings: true,
              installations: true,
              usageEvents: true,
            },
          },
        },
      });

    if (!skill) {
      return null;
    }

    const {
      installations,
      ...detail
    } = skill;

    return toSkillApiJson(
      this.map({
        ...detail,
        viewerCanManage:
          Boolean(manageable),
        viewerIsOwner:
          deletion.viewerIsOwner,
        viewerCanDelete:
          deletion.allowed,
        viewerDeleteBlockers:
          deletion.blockers,
        viewerInstallation:
          installations[0] ?? null,
      }),
    );
  }

  async deletedDetail(
    userId: string,
    skillId: string,
  ) {
    await this.access.deletedOwner(
      userId,
      skillId,
    );

    const skill =
      await this.repository.client().skill.findUnique({
        where: {
          id: skillId,
        },
        include: {
          currentVersion: true,
          source: true,

          createdBy: {
            select: {
              id: true,
              username: true,
            },
          },

          versions: {
            orderBy: {
              versionNumber: 'desc',
            },
            include: {
              _count: {
                select: {
                  files: true,
                },
              },
            },
          },

          _count: {
            select: {
              agentBindings: true,
              installations: true,
              usageEvents: true,
            },
          },
        },
      });

    if (!skill) {
      return null;
    }

    return toSkillApiJson(
      this.map({
        ...skill,
        viewerCanManage: false,
        viewerIsOwner: true,
        viewerCanDelete: false,
        viewerCanRestoreDeleted: true,
        viewerDeleteBlockers: [],
        viewerInstallation: null,
      }),
    );
  }

  async versions(
    userId: string,
    skillId: string,
  ) {
    await this.access.readable(
      userId,
      skillId,
    );

    return toSkillApiJson(
      await this.repository
        .client()
        .skillVersion.findMany({
          where: {
            skillId,
          },
          orderBy: {
            versionNumber: 'desc',
          },
          include: {
            _count: {
              select: {
                files: true,
                validationRuns: true,
              },
            },
          },
        }),
    );
  }

  async usage(
    userId: string,
    skillId: string,
    limit = 100,
  ) {
    await this.access.readable(
      userId,
      skillId,
    );

    return toSkillApiJson(
      await this.repository
        .client()
        .skillUsageEvent.findMany({
          where: {
            skillId,
          },
          orderBy: {
            occurredAt: 'desc',
          },
          take: Math.max(
            1,
            Math.min(limit, 200),
          ),
        }),
    );
  }

  async audit(
    userId: string,
    skillId: string,
    limit = 100,
  ) {
    await this.access.readable(
      userId,
      skillId,
    );

    return toSkillApiJson(
      await this.repository
        .client()
        .skillAuditLog.findMany({
          where: {
            skillId,
          },
          orderBy: {
            occurredAt: 'desc',
          },
          take: Math.max(
            1,
            Math.min(limit, 200),
          ),
        }),
    );
  }

  private map<
    T extends Record<string, unknown>,
  >(
    skill: T,
  ): T & {
    iconUrl: string | null;
    coverUrl: string | null;
  } {
    const iconKey =
      typeof skill.iconKey === 'string'
        ? skill.iconKey
        : '';

    const coverKey =
      typeof skill.coverKey === 'string'
        ? skill.coverKey
        : '';

    return {
      ...skill,
      iconUrl:
        resolveBuiltinAssetUrl(
          iconKey,
        )
        ?? (iconKey
          ? `/api/storage/${encodeURIComponent(
              iconKey,
            )}`
          : null),
      coverUrl:
        resolveBuiltinAssetUrl(
          coverKey,
        )
        ?? (coverKey
          ? `/api/storage/${encodeURIComponent(
              coverKey,
            )}`
          : null),
    };
  }
}