import type {
  GrowDraftResult,
  GrowResourceDraftCommand,
  GrowRouteDraftCommand,
  GrowSkillDraftCommand,
  GrowSkillVersionDraftCommand,
} from '../domain/grow.types';

export interface GrowSkillAuthoringPort {
  createSkillDraft(command: GrowSkillDraftCommand): Promise<GrowDraftResult>;
  createVersionDraft(command: GrowSkillVersionDraftCommand): Promise<GrowDraftResult>;
  updateRouteDraft(command: GrowRouteDraftCommand): Promise<GrowDraftResult>;
  addResourceDraft(command: GrowResourceDraftCommand): Promise<GrowDraftResult>;
  rejectDraft(input: {
    userId: string;
    versionId: string;
    reason: string;
    reviewId: string;
  }): Promise<void>;
}
