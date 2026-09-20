import { Injectable } from '@nestjs/common';
import {
  SkillActivationMode,
  SkillInstallationStatus,
  SkillPrincipalType,
  SkillSecurityState,
  SkillStatus,
} from '@prisma/client';
import { estimateTokens } from '../domain/skill-content.util';
import type { SkillCatalogEntry } from '../domain/skill.types';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillKeywordRouterService } from './skill-keyword-router.service';

@Injectable()
export class SkillSearchService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly router: SkillKeywordRouterService,
  ) {}

  async search(input: {
    userId: string;
    query: string;
    limit: number;
    excludeSkillIds?: string[];
  }): Promise<SkillCatalogEntry[]> {
    const skills = await this.repository.client().skill.findMany({
      where: {
        id: input.excludeSkillIds?.length ? { notIn: input.excludeSkillIds } : undefined,
        deletedAt: null,
        status: SkillStatus.ACTIVE,
        securityState: SkillSecurityState.CLEAR,
        currentVersionId: { not: null },
        OR: [
          { ownerUserId: input.userId },
          {
            installations: {
              some: {
                scopeType: SkillPrincipalType.USER,
                scopeId: input.userId,
                status: { not: SkillInstallationStatus.UNINSTALLED },
                enabled: true,
                removedAt: null,
              },
            },
          },
        ],
      },
      include: { currentVersion: true },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });

    return this.router.rank(input.query, skills.filter((skill) => Boolean(skill.currentVersion)), input.limit)
      .flatMap((skill) => skill.currentVersion ? [{
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        versionId: skill.currentVersion.id,
        version: skill.currentVersion.versionLabel,
        activationMode: SkillActivationMode.AUTOMATIC,
        source: 'DISCOVERABLE' as const,
        priority: skill.pinned ? 1 : 0,
        relevance: skill.relevance,
        trustLevel: skill.trustLevel,
        category: skill.category,
        tags: skill.tags,
        estimatedTokens: estimateTokens(`${skill.displayName}\n${skill.description}`),
        exclusiveGroup: null,
        conflictKeys: [],
      }] : []);
  }
}
