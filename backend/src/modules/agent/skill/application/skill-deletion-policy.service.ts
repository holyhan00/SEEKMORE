import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  evaluateSkillDeletion,
  type SkillDeleteBlocker,
} from '../domain/skill-deletion.policy';
import {
  SkillRepository,
  type SkillDbClient,
} from '../persistence/skill.repository';

export interface SkillDeletionEvaluation {
  allowed: boolean;
  viewerIsOwner: boolean;
  blockers: SkillDeleteBlocker[];
  snapshot: Record<string, unknown>;
}

@Injectable()
export class SkillDeletionPolicyService {
  constructor(private readonly repository: SkillRepository) {}

  async evaluate(
    userId: string,
    skillId: string,
    client: SkillDbClient = this.repository.client(),
  ): Promise<SkillDeletionEvaluation> {
    const skill = await client.skill.findUnique({ where: { id: skillId } });
    if (!skill) throw new NotFoundException('SKILL_NOT_FOUND');
    return {
      ...evaluateSkillDeletion(userId, { ownerUserId: skill.ownerUserId }),
      snapshot: skill as unknown as Record<string, unknown>,
    };
  }

  assertAllowed(evaluation: SkillDeletionEvaluation): void {
    if (!evaluation.viewerIsOwner) {
      throw new ForbiddenException('SKILL_DELETE_OWNER_REQUIRED');
    }
  }
}
