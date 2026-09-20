import { Injectable } from '@nestjs/common';
import type { SkillActivationDecision, SkillRuntimeSession } from '../domain/skill.types';
import { SkillConflictResolverService } from './skill-conflict-resolver.service';

@Injectable()
export class SkillResolverService {
  constructor(private readonly conflicts: SkillConflictResolverService) {}

  resolve(session: SkillRuntimeSession, skillName: string): SkillActivationDecision {
    const entry = session.internalCatalog.find(
      (candidate) => candidate.name === skillName,
    );
    if (!entry) {
      return this.reject(
        skillName,
        'SKILL_NOT_ALLOWED_THIS_TURN',
        'Skill is not available in the current turn catalog',
      );
    }
    if (
      entry.activationMode === 'MANUAL' &&
      entry.source !== 'USER_EXPLICIT' &&
      entry.source !== 'SESSION'
    ) {
      return this.reject(
        skillName,
        'SKILL_MANUAL_ACTIVATION_REQUIRED',
        'This Skill requires explicit user activation',
      );
    }
    const conflict = this.conflicts.conflict(session, entry);
    if (conflict) {
      return this.reject(
        skillName,
        'SKILL_CONFLICT',
        `Skill conflicts with already loaded Skill ${conflict.name}`,
      );
    }
    return {
      selectedSkillIds: [entry.id],
      reason: 'ASSOCIATED_SKILL',
      confidence: entry.relevance,
      activationMode: entry.activationMode,
      dependencyStatus: null,
      rejectedSkills: [],
      tokenEstimate: entry.estimatedTokens,
    };
  }

  private reject(skillName: string, code: string, reason: string): SkillActivationDecision {
    return {
      selectedSkillIds: [],
      reason,
      confidence: 0,
      activationMode: null,
      dependencyStatus: null,
      rejectedSkills: [{ skillId: skillName, code, reason }],
      tokenEstimate: 0,
    };
  }
}
