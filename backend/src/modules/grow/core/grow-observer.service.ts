import type {
  GrowReviewRecord,
  GrowTerminalEvent,
} from '../domain/grow.types';
import type { GrowClockPort } from '../ports/grow-clock.port';
import type { GrowEvidencePort } from '../ports/grow-evidence.port';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowObserverStatePort } from '../ports/grow-observer-state.port';
import type { GrowReviewRepositoryPort } from '../ports/grow-review-repository.port';
import { isGrowSyntheticTrace } from '../domain/grow-synthetic-run.util';
import { GrowEvidenceSanitizerService } from './grow-evidence-sanitizer.service';
import type { GrowPolicy } from './grow-policy';
import { GrowTriggerPolicyService } from './grow-trigger-policy.service';

export class GrowObserverService {
  constructor(
    private readonly evidence: GrowEvidencePort,
    private readonly sanitizer: GrowEvidenceSanitizerService,
    private readonly states: GrowObserverStatePort,
    private readonly reviews: GrowReviewRepositoryPort,
    private readonly trigger: GrowTriggerPolicyService,
    private readonly policy: GrowPolicy,
    private readonly clock: GrowClockPort,
    private readonly logger: GrowLoggerPort,
  ) {}

  async observe(event: GrowTerminalEvent): Promise<GrowReviewRecord | null> {
    this.logger.log({
      level: 'info',
      event: 'grow.observe.received',
      message: 'Grow Observer received a terminal Agent turn event.',
      fields: {
        eventId: event.eventId,
        turnId: event.turnId,
        traceId: event.traceId,
        status: event.status,
      },
    });

    if (isGrowSyntheticTrace(event.traceId)) {
      this.logger.log({
        level: 'debug',
        event: 'grow.observe.synthetic_turn_skipped',
        message: 'Grow Observer ignored a detached GROW_FOCUS terminal event.',
        fields: {
          eventId: event.eventId,
          turnId: event.turnId,
          traceId: event.traceId,
        },
      });
      return null;
    }

    if (await this.reviews.existsByEventId(event.eventId)) {
      this.logger.log({
        level: 'debug',
        event: 'grow.observe.duplicate',
        message: 'Grow Observer ignored a duplicate terminal event.',
        fields: { eventId: event.eventId },
      });
      return null;
    }

    const sourceEvidence = await this.evidence.loadTerminalEvidence(event);
    if (!sourceEvidence) {
      this.logger.log({
        level: 'debug',
        event: 'grow.observe.synthetic_evidence_skipped',
        message: 'Grow Observer rejected synthetic Grow evidence at the evidence boundary.',
        fields: {
          eventId: event.eventId,
          turnId: event.turnId,
          traceId: event.traceId,
        },
      });
      return null;
    }
    const terminal = this.sanitizer.sanitizeEvidence(sourceEvidence);
    const currentState = await this.states.getOrCreate(event.userId, event.agentId);

    if (!this.trigger.isObservable(terminal)) {
      this.logger.log({
        level: 'debug',
        event: 'grow.observe.ignored',
        message: 'Turn contained no Grow-observable activity and was not accumulated.',
        fields: { turnId: terminal.turnId },
      });
      return null;
    }

    const accumulated = await this.states.accumulate(currentState, terminal);
    const today = this.startOfDayIso(this.clock.now());
    const runsToday = await this.reviews.countCreatedSince(event.userId, today);
    const decision = this.trigger.evaluate(terminal, accumulated, runsToday);

    if (!decision.shouldRun || !decision.triggerType) return null;

    const recent = await this.evidence.loadRecentEvidence({
      userId: event.userId,
      agentId: event.agentId,
      conversationId: event.conversationId,
      afterTurnId: accumulated.lastReviewedTurnId,
      limit: this.policy.focus.recentTurnLimit,
    });
    const sanitized = recent
      .filter((item) => this.trigger.isObservable(item))
      .map((item) => this.sanitizer.sanitizeEvidence(item));
    if (!sanitized.some((item) => item.turnId === terminal.turnId)) {
      sanitized.push(terminal);
    }

    const review = await this.reviews.create({
      event,
      triggerType: decision.triggerType,
      evidence: sanitized.slice(-this.policy.focus.recentTurnLimit),
    });

                                                                      
    await this.states.markReviewed(
      accumulated,
      event.turnId,
      this.clock.now().toISOString(),
    );

    this.logger.log({
      level: 'info',
      event: 'grow.review.created',
      message: 'Grow Observer created a detached Grow review.',
      fields: {
        reviewId: review.id,
        triggerType: review.triggerType,
        evidenceCount: review.evidence.length,
        consumedToolIterations: accumulated.toolIterationsSinceReview,
      },
    });

    return review;
  }

  private startOfDayIso(date: Date): string {
    const value = new Date(date);
    value.setUTCHours(0, 0, 0, 0);
    return value.toISOString();
  }
}
