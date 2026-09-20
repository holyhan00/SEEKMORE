import type { AgentSkillBindingInput } from '../types/skill.types';

export const AGENT_SKILL_PRIORITY_MIN = 1;
export const AGENT_SKILL_PRIORITY_MAX = 1000;

export function sortAgentSkillBindings<
  T extends AgentSkillBindingInput,
>(bindings: T[]): T[] {
  return bindings
    .map((binding, index) => ({ binding, index }))
    .sort((left, right) => {
      return (
        Number(right.binding.enabled) -
          Number(left.binding.enabled) ||
        left.binding.priority - right.binding.priority ||
        left.index - right.index ||
        left.binding.skillId.localeCompare(
          right.binding.skillId,
        )
      );
    })
    .map(({ binding }) => binding);
}

export function nextAgentSkillPriority(
  bindings: AgentSkillBindingInput[],
): number {
  const highestPriority = bindings.reduce(
    (highest, binding) =>
      Math.max(highest, binding.priority),
    0,
  );

  return Math.min(
    Math.max(
      highestPriority + 1,
      AGENT_SKILL_PRIORITY_MIN,
    ),
    AGENT_SKILL_PRIORITY_MAX,
  );
}
