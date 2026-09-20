export type SkillDeleteBlocker = 'NOT_OWNER';

export interface SkillDeletionFacts {
  ownerUserId: string | null;
}

export interface SkillDeletionDecision {
  allowed: boolean;
  viewerIsOwner: boolean;
  blockers: SkillDeleteBlocker[];
}

export function evaluateSkillDeletion(
  userId: string,
  facts: SkillDeletionFacts,
): SkillDeletionDecision {
  const viewerIsOwner = facts.ownerUserId === userId;
  return {
    allowed: viewerIsOwner,
    viewerIsOwner,
    blockers: viewerIsOwner ? [] : ['NOT_OWNER'],
  };
}
