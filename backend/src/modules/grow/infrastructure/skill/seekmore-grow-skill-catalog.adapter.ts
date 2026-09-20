import { Injectable } from '@nestjs/common';
import { SkillSecurityState, SkillStatus, SkillVersionStatus } from '@prisma/client';
import { SkillRepository } from '../../../agent/skill/persistence/skill.repository';
import { SkillSearchService } from '../../../agent/skill/routing/skill-search.service';
import type { GrowRoutingProfile } from '../../domain/grow.types';
import type { GrowSkillCatalogPort } from '../../ports/grow-skill-catalog.port';

@Injectable()
export class SeekmoreGrowSkillCatalogAdapter implements GrowSkillCatalogPort {
  constructor(
    private readonly repository: SkillRepository,
    private readonly search: SkillSearchService,
  ) {}

  async findRelated(input: Parameters<GrowSkillCatalogPort['findRelated']>[0]) {
    const loadedIds = input.loadedSkills.map((skill) => skill.skillId);
    const loaded = await this.repository.client().skill.findMany({
      where: {
        id: { in: loadedIds },
        deletedAt: null,
        status: SkillStatus.ACTIVE,
        securityState: SkillSecurityState.CLEAR,
      },
      include: { currentVersion: true, source: true },
    });
    const loadedMap = new Map(loaded.map((skill) => [skill.id, skill]));
    const preferred = input.loadedSkills.flatMap((summary) => {
      const skill = loadedMap.get(summary.skillId);
      if (!skill?.currentVersion) return [];
      return [this.summary(skill, 1)];
    });
    const searched = await this.search.search({
      userId: input.userId,
      query: input.query,
      limit: input.limit,
      excludeSkillIds: preferred.map((skill) => skill.skillId),
    });
    const searchedSkills = await this.repository.client().skill.findMany({
      where: { id: { in: searched.map((item) => item.id) } },
      include: { currentVersion: true, source: true },
    });
    const relevance = new Map(searched.map((item) => [item.id, item.relevance]));
    return [...preferred, ...searchedSkills.flatMap((skill) =>
      skill.currentVersion ? [this.summary(skill, relevance.get(skill.id) ?? 0)] : [],
    )].slice(0, input.limit);
  }

  async readPublished(input: Parameters<GrowSkillCatalogPort['readPublished']>[0]) {
    const skill = await this.repository.findUserLibrarySkill(input.userId, input.skillId);
    if (
      !skill?.currentVersion ||
      skill.currentVersion.status !== SkillVersionStatus.PUBLISHED ||
      skill.status !== SkillStatus.ACTIVE ||
      skill.securityState !== SkillSecurityState.CLEAR
    ) return null;
    const version = await this.repository.client().skillVersion.findUnique({
      where: { id: skill.currentVersion.id },
      include: { files: { orderBy: { path: 'asc' } } },
    });
    if (!version) return null;
    return {
      ...this.summary(skill, 1),
      contentHash: version.packageChecksum,
      skillMarkdown: version.skillMarkdown,
      resources: version.files.flatMap((file) => file.textContent === null ? [] : [{
        path: file.path,
        mimeType: file.mimeType,
        textContent: file.textContent,
        executable: file.executable,
      }]),
    };
  }

  private summary(skill: any, relevance: number) {
    const version = skill.currentVersion;
    return {
      skillId: skill.id,
      versionId: version.id,
      name: skill.name,
      description: skill.description,
      source: skill.source?.kind ?? undefined,
      locked: skill.growLocked || skill.growEnabled === false,
      protected: skill.source?.kind === 'BUILTIN',
      relevance,
      activationDescription: skill.activationDescription,
      category: skill.category,
      tags: skill.tags,
      routingProfile: this.routingProfile(version.routingProfile),
    };
  }

  private routingProfile(value: unknown): GrowRoutingProfile {
    const row = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const strings = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
    const weighted = (value: unknown) => Array.isArray(value)
      ? value.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const record = item as Record<string, unknown>;
          const term = String(record.term ?? '').trim();
          return term ? [{ term, weight: Number(record.weight ?? 0.7) || 0.7 }] : [];
        })
      : [];
    return {
      aliases: strings(row.aliases),
      positiveTerms: weighted(row.positiveTerms),
      negativeTerms: weighted(row.negativeTerms),
      toolNames: strings(row.toolNames),
      capabilityKinds: strings(row.capabilityKinds),
      fileExtensions: strings(row.fileExtensions),
      artifactTypes: strings(row.artifactTypes),
    };
  }
}
