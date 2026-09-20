                                                                  

import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Cron,
  CronExpression,
} from '@nestjs/schedule';
import type {
  Prisma,
} from '@prisma/client';
import { SkillFileStorageService } from '../files/skill-file-storage.service';
import { SkillRepository } from '../persistence/skill.repository';

interface SkillPurgeCandidate {
  id: string;
  versions: Array<{
    files: Array<{
      storageKey: string | null;
    }>;
  }>;
}

@Injectable()
export class SkillPurgeService {
  private readonly logger = new Logger(
    SkillPurgeService.name,
  );

  constructor(
    private readonly repository: SkillRepository,
    private readonly storage: SkillFileStorageService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredSkills(): Promise<void> {
    const candidates =
      await this.repository
        .client()
        .skill.findMany({
          where: {
            deletedAt: {
              not: null,
            },
            purgeAfter: {
              lte: new Date(),
            },
          },
          select: {
            id: true,
            versions: {
              select: {
                files: {
                  where: {
                    storageKey: {
                      not: null,
                    },
                  },
                  select: {
                    storageKey: true,
                  },
                },
              },
            },
          },
          orderBy: {
            purgeAfter: 'asc',
          },
          take: 50,
        });

    for (const skill of candidates) {
      try {
        const deleted =
          await this.deleteDatabaseRecords(
            skill.id,
            {
              deletedAt: {
                not: null,
              },
              purgeAfter: {
                lte: new Date(),
              },
            },
          );

        if (!deleted) {
          continue;
        }

        await this.removeUnreferencedStorageObjects(
          this.storageKeys(skill),
        );

        this.logger.log(
          `Permanently deleted expired Skill ${skill.id}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to permanently delete Skill ${skill.id}`,
          error instanceof Error
            ? error.stack
            : String(error),
        );
      }
    }
  }

  async permanentlyDeleteOwned(
    userId: string,
    skillId: string,
  ): Promise<{
    id: string;
    permanentlyDeleted: true;
    removedStorageObjects: number;
  }> {
    const candidate =
      await this.repository
        .client()
        .skill.findFirst({
          where: {
            id: skillId,
            ownerUserId: userId,
            deletedAt: {
              not: null,
            },
          },
          select: {
            id: true,
            versions: {
              select: {
                files: {
                  where: {
                    storageKey: {
                      not: null,
                    },
                  },
                  select: {
                    storageKey: true,
                  },
                },
              },
            },
          },
        });

    if (!candidate) {
      throw new NotFoundException(
        'SKILL_DELETED_NOT_FOUND',
      );
    }

    const deleted =
      await this.deleteDatabaseRecords(
        skillId,
        {
          ownerUserId: userId,
          deletedAt: {
            not: null,
          },
        },
      );

    if (!deleted) {
      throw new NotFoundException(
        'SKILL_DELETED_NOT_FOUND',
      );
    }

    const removedStorageObjects =
      await this.removeUnreferencedStorageObjects(
        this.storageKeys(candidate),
      );

    this.logger.warn(
      `User ${userId} permanently deleted Skill ${skillId}`,
    );

    return {
      id: skillId,
      permanentlyDeleted: true,
      removedStorageObjects,
    };
  }

  private async deleteDatabaseRecords(
    skillId: string,
    guard: Prisma.SkillWhereInput,
  ): Promise<boolean> {
    return this.repository.transaction(
      async (tx) => {
        const candidate =
          await tx.skill.findFirst({
            where: {
              AND: [
                {
                  id: skillId,
                },
                guard,
              ],
            },
            select: {
              id: true,
            },
          });

        if (!candidate) {
          return false;
        }

        await tx.skillDependency.deleteMany({
          where: {
            dependencySkillId: skillId,
          },
        });

        await tx.skillUsageEvent.deleteMany({
          where: {
            skillId,
          },
        });

        await tx.skillAuditLog.deleteMany({
          where: {
            skillId,
          },
        });

        await tx.skill.delete({
          where: {
            id: skillId,
          },
        });

        return true;
      },
    );
  }

  private storageKeys(
    candidate: SkillPurgeCandidate,
  ): string[] {
    const keys = new Set<string>();

    for (
      const version of candidate.versions
    ) {
      for (const file of version.files) {
        if (file.storageKey) {
          keys.add(file.storageKey);
        }
      }
    }

    return [...keys];
  }

  private async removeUnreferencedStorageObjects(
    storageKeys: string[],
  ): Promise<number> {
    let removed = 0;

    for (const storageKey of storageKeys) {
      try {
        const remainingReferences =
          await this.repository
            .client()
            .skillFile.count({
              where: {
                storageKey,
              },
            });

        if (remainingReferences > 0) {
          continue;
        }

        await this.storage.remove(
          storageKey,
        );

        removed += 1;
      } catch (error) {
        this.logger.error(
          `Failed to remove Skill storage object ${storageKey}`,
          error instanceof Error
            ? error.stack
            : String(error),
        );
      }
    }

    return removed;
  }
}
