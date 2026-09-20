export const AGENT_SKILL_ACTIVATION_MODES = [
  'INHERIT',
  'MANUAL',
  'AUTOMATIC',
  'ALWAYS',
] as const;

export const AGENT_SKILL_EFFECTIVE_ACTIVATION_MODES = [
  'MANUAL',
  'AUTOMATIC',
  'ALWAYS',
] as const;

export type AgentSkillActivationMode =
  (typeof AGENT_SKILL_ACTIVATION_MODES)[number];

export type EffectiveAgentSkillActivationMode =
  (typeof AGENT_SKILL_EFFECTIVE_ACTIVATION_MODES)[number];

const EFFECTIVE_MODES = new Set<string>(
  AGENT_SKILL_EFFECTIVE_ACTIVATION_MODES,
);

export function normalizeAgentDefaultActivationMode(
  value: unknown,
): EffectiveAgentSkillActivationMode {
  const mode = String(value ?? '').trim().toUpperCase();

  return EFFECTIVE_MODES.has(mode)
    ? (mode as EffectiveAgentSkillActivationMode)
    : 'AUTOMATIC';
}

export function toAgentSkillActivationMode(
  value: unknown,
): AgentSkillActivationMode {
  const mode = String(value ?? '').trim().toUpperCase();

  if (mode === 'INHERIT' || !mode || mode === 'DISABLED') {
    return 'INHERIT';
  }

  return EFFECTIVE_MODES.has(mode)
    ? (mode as EffectiveAgentSkillActivationMode)
    : 'INHERIT';
}

export function toPersistenceActivationMode(
  mode: AgentSkillActivationMode,
): EffectiveAgentSkillActivationMode | null {
  return mode === 'INHERIT' ? null : mode;
}

export function resolveAgentSkillActivationMode(
  mode: AgentSkillActivationMode,
  defaultMode: EffectiveAgentSkillActivationMode,
): EffectiveAgentSkillActivationMode {
  return mode === 'INHERIT' ? defaultMode : mode;
}

export function isLegacyDisabledActivationMode(
  value: unknown,
): boolean {
  return String(value ?? '').trim().toUpperCase() === 'DISABLED';
}
