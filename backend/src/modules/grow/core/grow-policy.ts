export interface GrowPolicy {
  enabled: boolean;
  trigger: {
                                                                          
    toolIterationInterval: number;
    reviewOnExplicitLearning: boolean;
    reviewOnExplicitCorrection: boolean;
    reviewOnExplicitPreference: boolean;
    reviewOnLoadedSkillMethodFailure: boolean;
    minimumIntervalMs: number;
    maximumRunsPerDay: number;
  };
  focus: {
    recentTurnLimit: number;
    maximumActions: number;
    maxIterations: number;
    tokenBudget: number;
    timeoutMs: number;
    relatedSkillLimit: number;
  };
  publication: {
    automatic: boolean;
    automaticRollback: boolean;
  };
  professionalStudy: {
    enabled: boolean;
    maximumCallsPerReview: number;
  };
  authoring: {
    allowUpdateUserSkills: boolean;
    allowUpdateBuiltinSkills: boolean;
    allowUpdateLockedSkills: boolean;
  };
}


export interface GrowPolicyOverride {
  enabled?: boolean;
  trigger?: Partial<GrowPolicy['trigger']>;
  focus?: Partial<GrowPolicy['focus']>;
  publication?: Partial<GrowPolicy['publication']>;
  professionalStudy?: Partial<GrowPolicy['professionalStudy']>;
  authoring?: Partial<GrowPolicy['authoring']>;
}

export const DEFAULT_GROW_POLICY: GrowPolicy = {
  enabled: true,
  trigger: {
    toolIterationInterval: 10,
    reviewOnExplicitLearning: true,
    reviewOnExplicitCorrection: true,
    reviewOnExplicitPreference: true,
    reviewOnLoadedSkillMethodFailure: true,
    minimumIntervalMs: 5 * 60 * 1000,
    maximumRunsPerDay: 20,
  },
  focus: {
    recentTurnLimit: 6,
    maximumActions: 3,
    maxIterations: 8,
    tokenBudget: 12_000,
    timeoutMs: 120_000,
    relatedSkillLimit: 5,
  },
  publication: {
    automatic: true,
    automaticRollback: true,
  },
  professionalStudy: {
    enabled: true,
    maximumCallsPerReview: 1,
  },
  authoring: {
    allowUpdateUserSkills: true,
    allowUpdateBuiltinSkills: false,
    allowUpdateLockedSkills: false,
  },
};

export function mergeGrowPolicy(
  override: GrowPolicyOverride = {},
): GrowPolicy {
  return {
    ...DEFAULT_GROW_POLICY,
    ...override,
    trigger: {
      ...DEFAULT_GROW_POLICY.trigger,
      ...(override.trigger ?? {}),
    },
    focus: {
      ...DEFAULT_GROW_POLICY.focus,
      ...(override.focus ?? {}),
    },
    publication: {
      ...DEFAULT_GROW_POLICY.publication,
      ...(override.publication ?? {}),
    },
    professionalStudy: {
      ...DEFAULT_GROW_POLICY.professionalStudy,
      ...(override.professionalStudy ?? {}),
    },
    authoring: {
      ...DEFAULT_GROW_POLICY.authoring,
      ...(override.authoring ?? {}),
    },
  };
}
