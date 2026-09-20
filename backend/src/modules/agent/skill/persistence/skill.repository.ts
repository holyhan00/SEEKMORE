                                                                  

import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SkillInstallationStatus,
  SkillPermissionAction,
  SkillPrincipalType,
  SkillSecurityState,
  SkillSourceKind,
  SkillStatus,
  SkillVisibility,
} from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';

export type SkillDbClient =
  | PrismaService
  | Prisma.TransactionClient;

@Injectable()
export class SkillRepository {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  transaction<T>(
    work: (
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(work);
  }

  findAccessibleSkill(
    userId: string,
    skillId: string,
    client: SkillDbClient = this.prisma,
  ) {
    return client.skill.findFirst({
      where: {
        id: skillId,
        deletedAt: null,
        OR: [
          {
            ownerUserId: userId,
          },
          {
            visibility:
              SkillVisibility.PUBLIC,
            status: SkillStatus.ACTIVE,
            securityState:
              SkillSecurityState.CLEAR,
          },
          {
            installations: {
              some: {
                scopeType:
                  SkillPrincipalType.USER,
                scopeId: userId,
                enabled: true,
                removedAt: null,
              },
            },
          },
          {
            aclEntries: {
              some: {
                principalType:
                  SkillPrincipalType.USER,
                principalId: userId,
                permissions: {
                  hasSome: [
                    SkillPermissionAction.VIEW,
                    SkillPermissionAction.USE,
                  ],
                },
              },
            },
          },
        ],
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
      },
    });
  }

  findUserLibrarySkill(
    userId: string,
    skillId: string,
    client: SkillDbClient = this.prisma,
  ) {
    return client.skill.findFirst({
      where: {
        id: skillId,
        deletedAt: null,
        OR: [
          {
            ownerUserId: userId,
          },
          {
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
          },
        ],
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
      },
    });
  }


  findUserLibrarySkillIncludingDeleted(
    userId: string,
    skillId: string,
    client: SkillDbClient = this.prisma,
  ) {
    return client.skill.findFirst({
      where: {
        id: skillId,
        OR: [
          {
            ownerUserId: userId,
          },
          {
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
              },
            },
          },
        ],
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
      },
    });
  }

  findManageableSkill(
    userId: string,
    skillId: string,
    client: SkillDbClient = this.prisma,
  ) {
    return client.skill.findFirst({
      where: {
        id: skillId,
        deletedAt: null,
        OR: [
          {
            ownerUserId: userId,
          },
          {
            aclEntries: {
              some: {
                principalType:
                  SkillPrincipalType.USER,
                principalId: userId,
                permissions: {
                  has:
                    SkillPermissionAction.MANAGE,
                },
              },
            },
          },
        ],
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
      },
    });
  }

  findDeletedOwnedSkill(
    userId: string,
    skillId: string,
    client: SkillDbClient = this.prisma,
  ) {
    const now = new Date();

    return client.skill.findFirst({
      where: {
        id: skillId,
        ownerUserId: userId,
        deletedAt: {
          not: null,
        },
        OR: [
          {
            purgeAfter: null,
          },
          {
            purgeAfter: {
              gt: now,
            },
          },
        ],
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
      },
    });
  }

  listDeletedOwned(
    userId: string,
    where: Prisma.SkillWhereInput,
    skip: number,
    take: number,
  ) {
    const now = new Date();
    const deletedScope: Prisma.SkillWhereInput = {
      ownerUserId: userId,
      deletedAt: {
        not: null,
      },
      OR: [
        {
          purgeAfter: null,
        },
        {
          purgeAfter: {
            gt: now,
          },
        },
      ],
    };

    return this.prisma.$transaction([
      this.prisma.skill.findMany({
        where: {
          AND: [
            deletedScope,
            where,
          ],
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
          _count: {
            select: {
              versions: true,
              agentBindings: true,
              installations: true,
            },
          },
        },
        orderBy: [
          {
            deletedAt: 'desc',
          },
          {
            updatedAt: 'desc',
          },
        ],
        skip,
        take,
      }),
      this.prisma.skill.count({
        where: {
          AND: [
            deletedScope,
            where,
          ],
        },
      }),
    ]);
  }

  listAccessible(
    userId: string,
    where: Prisma.SkillWhereInput,
    skip: number,
    take: number,
  ) {
    const access: Prisma.SkillWhereInput = {
      OR: [
        {
          ownerUserId: userId,
        },
        {
          visibility: SkillVisibility.PUBLIC,
          status: SkillStatus.ACTIVE,
          securityState:
            SkillSecurityState.CLEAR,
        },
        {
          installations: {
            some: {
              scopeType:
                SkillPrincipalType.USER,
              scopeId: userId,
              enabled: true,
              removedAt: null,
            },
          },
        },
        {
          aclEntries: {
            some: {
              principalType:
                SkillPrincipalType.USER,
              principalId: userId,
              permissions: {
                hasSome: [
                  SkillPermissionAction.VIEW,
                  SkillPermissionAction.USE,
                ],
              },
            },
          },
        },
      ],
    };

    return this.prisma.$transaction([
      this.prisma.skill.findMany({
        where: {
          AND: [
            {
              deletedAt: null,
            },
            access,
            where,
          ],
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
          _count: {
            select: {
              versions: true,
              agentBindings: true,
              installations: true,
            },
          },
        },
        orderBy: [
          {
            pinned: 'desc',
          },
          {
            updatedAt: 'desc',
          },
        ],
        skip,
        take,
      }),
      this.prisma.skill.count({
        where: {
          AND: [
            {
              deletedAt: null,
            },
            access,
            where,
          ],
        },
      }),
    ]);
  }

  client(): PrismaService {
    return this.prisma;
  }
}