import type {
  GrowObserverState,
  GrowTriggerDecision,
  GrowTurnEvidence,
} from '../domain/grow.types';
import type { GrowClockPort } from '../ports/grow-clock.port';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowPolicy } from './grow-policy';

export class GrowTriggerPolicyService {
  constructor(
    private readonly policy: GrowPolicy,
    private readonly clock: GrowClockPort,
    private readonly logger: GrowLoggerPort,
  ) {}

                                                                                 
  isObservable(evidence: GrowTurnEvidence): boolean {
    if (evidence.terminalStatus === 'blocked' || evidence.terminalStatus === 'cancelled') {
      return false;
    }
    return (
      evidence.toolIterations > 0 ||
      Boolean(evidence.explicitLearningRequested) ||
      evidence.corrections.length > 0 ||
      evidence.explicitPreferences.length > 0 ||
      this.hasLoadedSkillMethodFailure(evidence)
    );
  }

  evaluate(
    evidence: GrowTurnEvidence,
    state: GrowObserverState,
    runsToday: number,
  ): GrowTriggerDecision {
    if (!this.policy.enabled) {
      return this.decision(false, state, 'Grow is disabled.');
    }

    if (runsToday >= this.policy.trigger.maximumRunsPerDay) {
      return this.decision(false, state, 'Daily Grow review budget exhausted.');
    }

    if (!this.isReviewEligible(evidence)) {
      return this.decision(false, state, 'Turn is not eligible for Grow review.');
    }

    if (!this.minimumIntervalSatisfied(state)) {
      return this.decision(false, state, 'Minimum Grow review interval has not elapsed.');
    }

    if (
      this.policy.trigger.reviewOnExplicitLearning &&
      evidence.explicitLearningRequested
    ) {
      return this.decision(
        true,
        state,
        'Explicit learning request detected.',
        'explicit_learning',
      );
    }

    if (
      this.policy.trigger.reviewOnExplicitCorrection &&
      evidence.corrections.length > 0
    ) {
      return this.decision(
        true,
        state,
        'Explicit correction detected.',
        'explicit_correction',
      );
    }

    if (
      this.policy.trigger.reviewOnExplicitPreference &&
      evidence.explicitPreferences.length > 0
    ) {
      return this.decision(
        true,
        state,
        'Explicit stable preference detected.',
        'explicit_preference',
      );
    }

    if (
      this.policy.trigger.reviewOnLoadedSkillMethodFailure &&
      this.hasLoadedSkillMethodFailure(evidence)
    ) {
      return this.decision(
        true,
        state,
        'A loaded Skill encountered a method-level failure.',
        'loaded_skill_method_failure',
      );
    }

    if (
      this.policy.trigger.toolIterationInterval > 0 &&
      state.toolIterationsSinceReview >= this.policy.trigger.toolIterationInterval
    ) {
      return this.decision(
        true,
        state,
        `Accumulated ${state.toolIterationsSinceReview} tool-enabled Agent iterations.`,
        'tool_interval',
      );
    }

    return this.decision(false, state, 'Grow trigger threshold not reached.');
  }

  private isReviewEligible(evidence: GrowTurnEvidence): boolean {
    if (!evidence.userNeed.trim()) return false;
    if (evidence.terminalStatus === 'blocked' || evidence.terminalStatus === 'cancelled') {
      return false;
    }

    if (evidence.terminalStatus === 'failed') {
      return this.hasLoadedSkillMethodFailure(evidence);
    }

    if (!evidence.finalResultSummary.trim()) return false;

    return (
      evidence.toolIterations > 0 ||
      Boolean(evidence.explicitLearningRequested) ||
      evidence.corrections.length > 0 ||
      evidence.explicitPreferences.length > 0 ||
      evidence.loadedSkills.length > 0 ||
      evidence.artifacts.some((artifact) => artifact.validationStatus === 'passed')
    );
  }

  private hasLoadedSkillMethodFailure(evidence: GrowTurnEvidence): boolean {
    return (
      evidence.loadedSkills.length > 0 &&
      evidence.failures.some((failure) => failure.type === 'method_error')
    );
  }

  private minimumIntervalSatisfied(state: GrowObserverState): boolean {
    if (!state.lastReviewAt || this.policy.trigger.minimumIntervalMs <= 0) return true;
    const elapsed = this.clock.now().getTime() - new Date(state.lastReviewAt).getTime();
    return elapsed >= this.policy.trigger.minimumIntervalMs;
  }

  private decision(
    shouldRun: boolean,
    state: GrowObserverState,
    reason: string,
    triggerType?: GrowTriggerDecision['triggerType'],
  ): GrowTriggerDecision {
    const decision: GrowTriggerDecision = {
      shouldRun,
      triggerType,
      reason,
      counters: { ...state },
    };

    this.logger.log({
      level: shouldRun ? 'info' : 'debug',
      event: 'grow.trigger.decision',
      message: reason,
      fields: {
        shouldRun,
        triggerType: triggerType ?? null,
        toolIterationsSinceReview: state.toolIterationsSinceReview,
      },
    });

    return decision;
  }
}
