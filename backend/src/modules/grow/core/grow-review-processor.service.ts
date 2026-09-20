import { GrowError } from '../domain/grow.errors';
import type {
  GrowFocusResult,
  GrowProcessResult,
  GrowProfessionalStudyResult,
  GrowReviewRecord,
} from '../domain/grow.types';
import type { GrowClockPort } from '../ports/grow-clock.port';
import type { GrowFocusAgentPort } from '../ports/grow-focus-agent.port';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowProfessionalStudyPort } from '../ports/grow-professional-study.port';
import type { GrowReviewRepositoryPort } from '../ports/grow-review-repository.port';
import { GrowActionExecutorService } from './grow-action-executor.service';
import { GrowDecisionGuardService } from './grow-decision-guard.service';
import { GrowFocusContextService } from './grow-focus-context.service';
import { GrowFocusPromptBuilder } from './grow-focus-prompt.builder';
import { GrowFocusResultValidator } from './grow-focus-result.validator';
import type { GrowPolicy } from './grow-policy';
import { GrowPublicationCoordinatorService } from './grow-publication-coordinator.service';

   
                                                                             
                                                                             
   
export const GROW_FOCUS_READ_TOOL_NAMES = [
  'skill_search',
  'skill_view',
  'skill_read_resource',
] as const;

export class GrowReviewProcessorService {
  constructor(
    private readonly reviews: GrowReviewRepositoryPort,
    private readonly contextBuilder: GrowFocusContextService,
    private readonly focusAgent: GrowFocusAgentPort,
    private readonly promptBuilder: GrowFocusPromptBuilder,
    private readonly validator: GrowFocusResultValidator,
    private readonly guard: GrowDecisionGuardService,
    private readonly study: GrowProfessionalStudyPort,
    private readonly actionExecutor: GrowActionExecutorService,
    private readonly publication: GrowPublicationCoordinatorService,
    private readonly policy: GrowPolicy,
    private readonly clock: GrowClockPort,
    private readonly logger: GrowLoggerPort,
  ) {}

  async process(reviewId: string): Promise<GrowProcessResult> {
    const review = await this.requireReview(reviewId);
    if (review.status === 'completed' || review.status === 'skipped') {
      return this.result(review);
    }

    const startedAt = this.clock.now().toISOString();
    await this.reviews.updateStatus(reviewId, 'running', {
      attemptCount: review.attemptCount + 1,
      startedAt,
    });

    this.logger.log({
      level: 'info',
      event: 'grow.focus.start',
      message: 'Starting detached GROW_FOCUS review.',
      fields: {
        reviewId,
        triggerType: review.triggerType,
        sourceTurnCount: review.evidence.length,
        writeAccess: false,
      },
    });

    try {
      const context = await this.contextBuilder.build(review);
      let focusResult = await this.runFocus(context);
      focusResult = await this.resolveProfessionalStudy(context, focusResult);
      const guarded = this.guard.guard(focusResult, context);

      const draftIds: string[] = [];
      const publishedVersionIds: string[] = [];
      const rejectedVersionIds: string[] = [];

      for (const action of guarded.actions) {
        const draft = await this.actionExecutor.execute({
          review,
          context: {
            ...context,
            professionalStudy: context.professionalStudy,
          },
          action,
        });
        if (!draft) continue;
        draftIds.push(draft.draftId);

        const publication = await this.publication.validateAndPublish({
          userId: review.userId,
          reviewId,
          draft,
        });
        if (publication.published) {
          publishedVersionIds.push(publication.versionId);
        } else {
          rejectedVersionIds.push(publication.versionId);
        }
      }

      const completed: GrowReviewRecord = {
        ...review,
        status: guarded.actions.length ? 'completed' : 'skipped',
        focusResult: guarded,
        createdDraftIds: draftIds,
        publishedVersionIds,
        rejectedVersionIds,
        attemptCount: review.attemptCount + 1,
        startedAt,
        completedAt: this.clock.now().toISOString(),
      };
      await this.reviews.save(completed);

      this.logger.log({
        level: 'info',
        event: 'grow.focus.completed',
        message: 'Detached GROW_FOCUS review completed.',
        fields: {
          reviewId,
          actionCount: guarded.actions.length,
          draftCount: draftIds.length,
          publishedCount: publishedVersionIds.length,
          rejectedCount: rejectedVersionIds.length,
        },
      });

      return this.result(completed);
    } catch (error) {
      const growError = error instanceof GrowError
        ? error
        : new GrowError(
            'GROW_REVIEW_PROCESSING_FAILED',
            error instanceof Error ? error.message : String(error),
            true,
          );

      const failed: GrowReviewRecord = {
        ...review,
        status: 'failed',
        attemptCount: review.attemptCount + 1,
        startedAt,
        completedAt: this.clock.now().toISOString(),
        error: {
          code: growError.code,
          message: growError.message,
        },
      };
      await this.reviews.save(failed);

      this.logger.log({
        level: 'error',
        event: 'grow.focus.failed',
        message: growError.message,
        fields: {
          reviewId,
          code: growError.code,
          retryable: growError.retryable,
        },
      });
      throw growError;
    }
  }

  private async runFocus(
    context: Parameters<GrowFocusAgentPort['run']>[0]['context'],
  ): Promise<GrowFocusResult> {
    const raw = await this.focusAgent.run({
      context,
      systemPrompt: this.promptBuilder.buildSystemPrompt(),
      toolNames: [...GROW_FOCUS_READ_TOOL_NAMES],
      maxIterations: this.policy.focus.maxIterations,
      tokenBudget: this.policy.focus.tokenBudget,
      timeoutMs: this.policy.focus.timeoutMs,
    });
    return this.validator.validate(raw, this.policy.focus.maximumActions);
  }

  private async resolveProfessionalStudy(
    context: Parameters<GrowFocusAgentPort['run']>[0]['context'],
    result: GrowFocusResult,
  ): Promise<GrowFocusResult> {
    const requests = result.actions.filter(
      (action) => action.action === 'REQUEST_STUDY' && action.studyRequest,
    );

    if (!requests.length) return result;
    if (!this.policy.professionalStudy.enabled) {
      this.logger.log({
        level: 'warn',
        event: 'grow.study.disabled',
        message: 'Professional study was requested but is disabled by policy.',
        fields: { reviewId: context.reviewId },
      });
      return {
        ...result,
        actions: result.actions.filter((action) => action.action !== 'REQUEST_STUDY'),
      };
    }

    const limited = requests.slice(0, this.policy.professionalStudy.maximumCallsPerReview);
    const findings: GrowProfessionalStudyResult[] = [];
    for (const action of limited) {
      const studyRequest = action.studyRequest;
      if (!studyRequest) continue;
      this.logger.log({
        level: 'info',
        event: 'grow.study.start',
        message: 'Grow Focus requested external professional study.',
        fields: {
          reviewId: context.reviewId,
          question: studyRequest.question,
        },
      });
      const studyResult = await this.study.study(studyRequest, {
        userId: context.scope.userId,
        conversationId: context.scope.conversationId,
        traceId: context.trigger.traceId,
        reviewId: context.reviewId,
      });
      findings.push(studyResult);
      this.logger.log({
        level: 'info',
        event: 'grow.study.completed',
        message: 'Professional study completed and will be fed back to Grow Focus.',
        fields: {
          reviewId: context.reviewId,
          findingCount: studyResult.findings.length,
          limitationCount: studyResult.limitations.length,
        },
      });
    }

    const rerunContext = {
      ...context,
      professionalStudy: findings,
    };
    const rerun = await this.runFocus(rerunContext);
    const withoutRepeatedStudy = rerun.actions.filter((action) => {
      if (action.action !== 'REQUEST_STUDY') return true;
      this.logger.log({
        level: 'warn',
        event: 'grow.study.repeat_rejected',
        message: 'Repeated professional study request was rejected after the review budget was consumed.',
        fields: { reviewId: context.reviewId },
      });
      return false;
    });
    context.professionalStudy = findings;
    return {
      ...rerun,
      worthLearning: withoutRepeatedStudy.some((action) => action.action !== 'IGNORE'),
      actions: withoutRepeatedStudy,
    };
  }

  private async requireReview(reviewId: string): Promise<GrowReviewRecord> {
    const review = await this.reviews.get(reviewId);
    if (!review) {
      throw new GrowError('GROW_REVIEW_NOT_FOUND', `Grow review ${reviewId} was not found.`);
    }
    return review;
  }

  private result(review: GrowReviewRecord): GrowProcessResult {
    return {
      reviewId: review.id,
      status: review.status,
      actionCount: review.focusResult?.actions.length ?? 0,
      draftIds: review.createdDraftIds,
      publishedVersionIds: review.publishedVersionIds,
      rejectedVersionIds: review.rejectedVersionIds,
    };
  }
}