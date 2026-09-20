import { Injectable, NotFoundException } from '@nestjs/common';
import type { TestSkillDto } from '../api/dto/skill.dto';
import { SkillAccessService } from './skill-access.service';
import { SkillLoaderService } from '../loading/skill-loader.service';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillCapabilityResolverService } from '../capability/skill-capability-resolver.service';

@Injectable()
export class SkillTestService {
  constructor(
    private readonly access: SkillAccessService,
    private readonly repository: SkillRepository,
    private readonly loader: SkillLoaderService,
    private readonly capabilities: SkillCapabilityResolverService,
  ) {}

  async test(userId: string, skillId: string, dto: TestSkillDto) {
    const skill = await this.access.manageable(userId, skillId);
    const version = dto.versionId
      ? await this.repository.client().skillVersion.findFirst({
          where: { id: dto.versionId, skillId },
        })
      : await this.repository.client().skillVersion.findFirst({
          where: {
            skillId,
            OR: [
              { status: 'DRAFT' },
              ...(skill.currentVersionId ? [{ id: skill.currentVersionId }] : []),
            ],
          },
          orderBy: { versionNumber: 'desc' },
        });
    if (!version) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');

    const capabilityStatus = this.capabilities.inspectPolicy(version.executionPolicy);
    const loaded = await this.loader.load({
      skillId,
      versionId: version.id,
      activationMode: 'MANUAL',
      source: 'USER_EXPLICIT',
      allowNonActive: true,
    });

    return {
      ready: capabilityStatus.ready,
      capabilityStatus,
      skill: loaded,
      noteCode: capabilityStatus.ready
        ? 'SKILL_TEST_READY'
        : 'SKILL_TEST_CAPABILITY_BLOCKED',
      note: capabilityStatus.ready
        ? 'The test validates Skill loading, capability catalog resolution, dependencies, and contracts without bypassing Agent Tool Runtime for scripts or external actions.'
        : 'The Skill has unresolved or unavailable required capabilities and cannot pass publication validation.',
    };
  }
}
