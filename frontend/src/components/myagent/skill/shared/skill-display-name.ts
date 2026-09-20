import type { SkillSummary } from '../types/skill.types';

export function getSkillDisplayName(
  skill: Pick<SkillSummary, 'displayName' | 'name'>,
): string {
  return skill.displayName?.trim() || skill.name;
}
