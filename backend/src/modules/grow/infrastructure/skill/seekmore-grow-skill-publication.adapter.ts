import { Injectable } from '@nestjs/common';
import { SkillLifecycleService } from '../../../agent/skill/application/skill-lifecycle.service';
import { SkillVersionService } from '../../../agent/skill/application/skill-version.service';
import { SkillValidationService } from '../../../agent/skill/validation/skill-validation.service';
import { SkillRepository } from '../../../agent/skill/persistence/skill.repository';
import type { GrowSkillPublicationPort } from '../../ports/grow-skill-publication.port';

@Injectable()
export class SeekmoreGrowSkillPublicationAdapter implements GrowSkillPublicationPort {
  constructor(
    private readonly lifecycle: SkillLifecycleService,
    private readonly versions: SkillVersionService,
    private readonly validation: SkillValidationService,
    private readonly repository: SkillRepository,
  ) {}

  async publish(input: Parameters<GrowSkillPublicationPort['publish']>[0]) {
    const skill = await this.repository.client().skill.findUnique({ where: { id: input.skillId } });
    const previousVersionId = skill?.currentVersionId ?? undefined;
    await this.lifecycle.publish(input.userId, input.skillId, input.versionId);
    return {
      published: true,
      skillId: input.skillId,
      versionId: input.versionId,
      previousVersionId,
    };
  }

  async rollback(input: Parameters<GrowSkillPublicationPort['rollback']>[0]) {
    const restored = await this.versions.restore(input.userId, input.skillId, input.previousVersionId);
    const result = await this.validation.validate(input.userId, input.skillId, restored.id);
    if (!result.valid) throw new Error('GROW_ROLLBACK_VALIDATION_FAILED');
    await this.lifecycle.publish(input.userId, input.skillId, restored.id);
  }
}
