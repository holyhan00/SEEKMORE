import type { SkillSource } from '../types/skill.types';

export function isAgentGeneratedSkillSource(
  source: SkillSource | null | undefined,
): boolean {
  return Boolean(
    source
    && source.kind === 'INLINE'
    && source.provenance?.generatedBy === 'seekmore-agent-loop',
  );
}
