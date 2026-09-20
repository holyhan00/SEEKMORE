import type {
  GrowEffectObservation,
  GrowSkillUseEvent,
} from '../domain/grow.types';
import type { GrowClockPort } from '../ports/grow-clock.port';
import type { GrowEffectStatePort } from '../ports/grow-effect-state.port';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowSkillPublicationPort } from '../ports/grow-skill-publication.port';
import type { GrowPolicy } from './grow-policy';

export class GrowEffectTrackerService {
  constructor(
    private readonly states: GrowEffectStatePort,
    private readonly publication: GrowSkillPublicationPort,
    private readonly policy: GrowPolicy,
    private readonly clock: GrowClockPort,
    private readonly logger: GrowLoggerPort,
  ) {}

  async registerPublication(input: {
    userId: string;
    reviewId: string;
    skillId: string;
    versionId: string;
    previousVersionId?: string;
  }): Promise<void> {
    await this.states.register({
      ...input,
      publishedAt: this.clock.now().toISOString(),
      completedCount: 0,
      failedCount: 0,
      rejectedCount: 0,
      consecutiveFailures: 0,
      totalObserved: 0,
    });

    this.logger.log({
      level: 'info',
      event: 'grow.effect.observation_started',
      message: 'Started post-publication observation for Grow Skill version.',
      fields: input,
    });
  }

  async recordUsage(event: GrowSkillUseEvent): Promise<void> {
    if (await this.states.hasProcessedEvent(event.eventId)) return;
    const state = await this.states.get(event.skillId, event.versionId);
    if (!state || state.closedAt || state.rolledBackAt) {
      await this.states.markProcessedEvent(event.eventId);
      return;
    }

    const next: GrowEffectObservation = {
      ...state,
      totalObserved: state.totalObserved + 1,
      completedCount:
        state.completedCount + (event.outcome === 'completed' ? 1 : 0),
      failedCount:
        state.failedCount +
        (event.outcome === 'failed' || event.outcome === 'load_failed' ? 1 : 0),
      rejectedCount:
        state.rejectedCount + (event.outcome === 'rejected' ? 1 : 0),
      consecutiveFailures:
        event.outcome === 'completed'
          ? 0
          : state.consecutiveFailures + 1,
    };

    const shouldRollback = this.shouldRollback(next, event);
    if (shouldRollback && next.previousVersionId && this.policy.publication.automaticRollback) {
      await this.publication.rollback({
        userId: next.userId,
        skillId: next.skillId,
        failedVersionId: next.versionId,
        previousVersionId: next.previousVersionId,
        reviewId: next.reviewId,
        reason: shouldRollback,
      });
      next.rolledBackAt = this.clock.now().toISOString();
      next.closedAt = next.rolledBackAt;

      this.logger.log({
        level: 'error',
        event: 'grow.rollback.succeeded',
        message: 'Grow Skill version was automatically rolled back.',
        fields: {
          skillId: next.skillId,
          failedVersionId: next.versionId,
          restoredVersionId: next.previousVersionId,
          reason: shouldRollback,
          totalObserved: next.totalObserved,
        },
      });
    } else if (next.totalObserved >= 10) {
      next.closedAt = this.clock.now().toISOString();
      this.logger.log({
        level: 'info',
        event: 'grow.effect.observation_completed',
        message: 'Grow Skill version completed its initial observation window.',
        fields: {
          skillId: next.skillId,
          versionId: next.versionId,
          completedCount: next.completedCount,
          failedCount: next.failedCount,
          rejectedCount: next.rejectedCount,
        },
      });
    }

    await this.states.save(next);
    await this.states.markProcessedEvent(event.eventId);
  }

  private shouldRollback(
    state: GrowEffectObservation,
    event: GrowSkillUseEvent,
  ): string | null {
    if (event.outcome === 'load_failed') return 'GROW_RUNTIME_LOAD_FAILURE';
    if (state.consecutiveFailures >= 3) return 'GROW_CONSECUTIVE_FAILURE_THRESHOLD';

    const negative = state.failedCount + state.rejectedCount;
    if (state.totalObserved >= 5 && negative / state.totalObserved > 0.5) {
      return 'GROW_NEGATIVE_OUTCOME_RATE_THRESHOLD';
    }
    return null;
  }
}
