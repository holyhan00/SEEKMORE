import type {
  GrowDraftResult,
  GrowPublicationResult,
} from '../domain/grow.types';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowSkillAuthoringPort } from '../ports/grow-skill-authoring.port';
import type {
  GrowSkillPublicationPort,
  GrowSkillValidationPort,
} from '../ports/grow-skill-publication.port';
import type { GrowPolicy } from './grow-policy';
import { GrowEffectTrackerService } from './grow-effect-tracker.service';

export class GrowPublicationCoordinatorService {
  constructor(
    private readonly validation: GrowSkillValidationPort,
    private readonly publication: GrowSkillPublicationPort,
    private readonly authoring: GrowSkillAuthoringPort,
    private readonly policy: GrowPolicy,
    private readonly effectTracker: GrowEffectTrackerService,
    private readonly logger: GrowLoggerPort,
  ) {}

  async validateAndPublish(input: {
    userId: string;
    reviewId: string;
    draft: GrowDraftResult;
  }): Promise<GrowPublicationResult> {
    const { userId, reviewId, draft } = input;

    this.logger.log({
      level: 'info',
      event: 'grow.validation.start',
      message: 'Starting deterministic validation for Grow draft.',
      fields: {
        reviewId,
        skillId: draft.skillId,
        versionId: draft.versionId,
        draftKind: draft.kind,
      },
    });

    const validation = await this.validation.validate({
      userId,
      skillId: draft.skillId,
      versionId: draft.versionId,
      reviewId,
    });

    if (!validation.passed) {
      const reason = validation.issues
        .filter((issue) => issue.severity === 'error' || issue.severity === 'critical')
        .map((issue) => issue.code)
        .join(', ') || 'GROW_VALIDATION_FAILED';

      await this.authoring.rejectDraft({
        userId,
        versionId: draft.versionId,
        reason,
        reviewId,
      });

      this.logger.log({
        level: 'warn',
        event: 'grow.validation.failed',
        message: 'Grow draft failed deterministic validation and was rejected.',
        fields: {
          reviewId,
          skillId: draft.skillId,
          versionId: draft.versionId,
          validationRunId: validation.validationRunId,
          issues: validation.issues,
        },
      });

      return {
        published: false,
        skillId: draft.skillId,
        versionId: draft.versionId,
        reason,
      };
    }

    this.logger.log({
      level: 'info',
      event: 'grow.validation.passed',
      message: 'Grow draft passed deterministic validation.',
      fields: {
        reviewId,
        skillId: draft.skillId,
        versionId: draft.versionId,
        validationRunId: validation.validationRunId,
      },
    });

    if (!this.policy.publication.automatic) {
      return {
        published: false,
        skillId: draft.skillId,
        versionId: draft.versionId,
        reason: 'GROW_AUTOMATIC_PUBLICATION_DISABLED',
      };
    }

    const result = await this.publication.publish({
      userId,
      skillId: draft.skillId,
      versionId: draft.versionId,
      reviewId,
    });

    if (result.published) {
      await this.effectTracker.registerPublication({
        userId,
        reviewId,
        skillId: result.skillId,
        versionId: result.versionId,
        previousVersionId: result.previousVersionId,
      });
    }

    this.logger.log({
      level: result.published ? 'info' : 'warn',
      event: result.published ? 'grow.publication.succeeded' : 'grow.publication.failed',
      message: result.published
        ? 'Grow Skill version was automatically published.'
        : 'Grow Skill version was not published.',
      fields: {
        reviewId,
        skillId: result.skillId,
        versionId: result.versionId,
        previousVersionId: result.previousVersionId ?? null,
        reason: result.reason ?? null,
      },
    });

    return result;
  }
}
