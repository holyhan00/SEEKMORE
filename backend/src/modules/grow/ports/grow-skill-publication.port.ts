import type {
  GrowPublicationResult,
  GrowValidationResult,
} from '../domain/grow.types';

export interface GrowSkillValidationPort {
  validate(input: {
    userId: string;
    skillId: string;
    versionId: string;
    reviewId: string;
  }): Promise<GrowValidationResult>;
}

export interface GrowSkillPublicationPort {
  publish(input: {
    userId: string;
    skillId: string;
    versionId: string;
    reviewId: string;
  }): Promise<GrowPublicationResult>;
  rollback(input: {
    userId: string;
    skillId: string;
    failedVersionId: string;
    previousVersionId: string;
    reviewId: string;
    reason: string;
  }): Promise<void>;
}
