import { Injectable } from '@nestjs/common';
import { SkillSourceKind, SkillVersionStatus } from '@prisma/client';
import { SkillCreationService } from '../../../agent/skill/application/skill-creation.service';
import { SkillVersionService } from '../../../agent/skill/application/skill-version.service';
import { SkillRepository } from '../../../agent/skill/persistence/skill.repository';
import type { GrowSkillAuthoringPort } from '../../ports/grow-skill-authoring.port';

@Injectable()
export class SeekmoreGrowSkillAuthoringAdapter implements GrowSkillAuthoringPort {
  constructor(
    private readonly creation: SkillCreationService,
    private readonly versions: SkillVersionService,
    private readonly repository: SkillRepository,
  ) {}

  async createSkillDraft(command: Parameters<GrowSkillAuthoringPort['createSkillDraft']>[0]) {
    await this.creation.create(command.ownerUserId, {
      source: 'AI_GENERATED',
      sourceKind: SkillSourceKind.INLINE,
      displayName: command.displayName,
      preferredInternalName: command.name,
      rootName: command.name,
      skillMarkdown: this.withImmutableName(command.skillMarkdown, command.name, command.description),
      resources: command.resources.map((resource) => ({
        path: resource.path,
        mimeType: resource.mimeType,
        buffer: Buffer.from(resource.textContent, 'utf8'),
      })),
      category: command.category ?? null,
      tags: command.tags,
      routingProfile: command.routingProfile as unknown as Record<string, unknown>,
      growProvenance: command.provenance as unknown as Record<string, unknown>,
      provenance: {
        origin: 'GROW_FOCUS',
        reviewId: command.reviewId,
      },
    });
    const skill = await this.repository.client().skill.findFirst({
      where: {
        ownerUserId: command.ownerUserId,
        name: command.name,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { versions: { where: { status: SkillVersionStatus.DRAFT }, orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    const version = skill?.versions[0];
    if (!skill || !version) throw new Error('GROW_SKILL_DRAFT_CREATE_FAILED');
    return { draftId: version.id, skillId: skill.id, versionId: version.id, kind: 'skill' as const };
  }

  async createVersionDraft(command: Parameters<GrowSkillAuthoringPort['createVersionDraft']>[0]) {
    const current = await this.repository.client().skill.findUnique({ where: { id: command.skillId } });
    if (!current) throw new Error('GROW_SKILL_NOT_FOUND');
    const version = await this.versions.createAutomatedDraft(command.ownerUserId, command.skillId, {
      baseVersionId: command.baseVersionId,
      basePackageChecksum: command.baseContentHash,
      skillMarkdown: this.withImmutableName(command.skillMarkdown, current.name, current.description),
      changeLog: command.changeLog,
      resources: command.resources,
      routingProfile: command.routingProfile as unknown as Record<string, unknown> | undefined,
      growProvenance: command.provenance as unknown as Record<string, unknown>,
    });
    return {
      draftId: version.id,
      skillId: command.skillId,
      versionId: version.id,
      kind: 'version' as const,
      currentPublishedVersionId: command.baseVersionId,
    };
  }

  async updateRouteDraft(command: Parameters<GrowSkillAuthoringPort['updateRouteDraft']>[0]) {
    const version = await this.versions.createAutomatedDraft(command.ownerUserId, command.skillId, {
      baseVersionId: command.baseVersionId,
      basePackageChecksum: command.baseContentHash,
      changeLog: 'Grow updated automatic routing metadata.',
      routingProfile: command.routingProfile as unknown as Record<string, unknown>,
      growProvenance: command.provenance as unknown as Record<string, unknown>,
    });
    return {
      draftId: version.id,
      skillId: command.skillId,
      versionId: version.id,
      kind: 'route' as const,
      currentPublishedVersionId: command.baseVersionId,
    };
  }

  async addResourceDraft(command: Parameters<GrowSkillAuthoringPort['addResourceDraft']>[0]) {
    const version = await this.versions.createAutomatedDraft(command.ownerUserId, command.skillId, {
      baseVersionId: command.baseVersionId,
      basePackageChecksum: command.baseContentHash,
      changeLog: 'Grow added reusable Skill resources.',
      resources: command.resources,
      growProvenance: command.provenance as unknown as Record<string, unknown>,
    });
    return {
      draftId: version.id,
      skillId: command.skillId,
      versionId: version.id,
      kind: 'resource' as const,
      currentPublishedVersionId: command.baseVersionId,
    };
  }

  async rejectDraft(input: Parameters<GrowSkillAuthoringPort['rejectDraft']>[0]) {
    const version = await this.repository.client().skillVersion.findUnique({ where: { id: input.versionId } });
    if (!version) return;
    await this.versions.rejectDraft(input.userId, version.skillId, version.id, input.reason);
  }

  private withImmutableName(markdown: string, name: string, description: string): string {
    const source = String(markdown ?? '').trim();
    const safeDescription = String(description ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (!source.startsWith('---')) {
      return `---\nname: ${name}\ndescription: ${safeDescription}\n---\n\n${source}`;
    }
    const end = source.indexOf('\n---', 3);
    if (end < 0) return source;
    const header = source.slice(0, end + 1);
    const body = source.slice(end + 4).replace(/^\s+/, '');
    const nextHeader = /(^|\n)name\s*:/m.test(header)
      ? header.replace(/(^|\n)name\s*:[^\n]*/m, `$1name: ${name}`)
      : `${header}\nname: ${name}`;
    return `${nextHeader}\n---\n\n${body}`;
  }
}
