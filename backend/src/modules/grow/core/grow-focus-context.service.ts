import type {
  GrowFocusContext,
  GrowReviewRecord,
  GrowTurnEvidence,
} from '../domain/grow.types';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowSkillCatalogPort } from '../ports/grow-skill-catalog.port';
import { isGrowSyntheticTrace } from '../domain/grow-synthetic-run.util';
import type { GrowPolicy } from './grow-policy';

export class GrowFocusContextService {
  constructor(
    private readonly skills: GrowSkillCatalogPort,
    private readonly policy: GrowPolicy,
    private readonly logger: GrowLoggerPort,
  ) {}

  async build(review: GrowReviewRecord): Promise<GrowFocusContext> {
    const sourceEvidence = review.evidence.filter(
      (item) => !isGrowSyntheticTrace(item.traceId),
    );
    const removedSyntheticCount = review.evidence.length - sourceEvidence.length;
    if (removedSyntheticCount > 0) {
      this.logger.log({
        level: 'warn',
        event: 'grow.focus.synthetic_evidence_repaired',
        message: 'Synthetic Grow evidence reached the Focus boundary and was removed.',
        fields: {
          reviewId: review.id,
          removedSyntheticCount,
        },
      });
    }
    if (!sourceEvidence.length) {
      throw new Error('GROW_FOCUS_NO_CLEAN_SOURCE_EVIDENCE');
    }

    const evidence = sourceEvidence.slice(-this.policy.focus.recentTurnLimit);
    const latest = evidence[evidence.length - 1];
    const loadedSkills = this.uniqueLoadedSkills(evidence);
    const query = this.buildSearchQuery(evidence);
    const relatedSkills = await this.skills.findRelated({
      userId: review.userId,
      agentId: review.agentId,
      query,
      loadedSkills,
      limit: this.policy.focus.relatedSkillLimit,
    });

    const context: GrowFocusContext = {
      reviewId: review.id,
      trigger: {
        type: review.triggerType,
        turnId: review.triggerTurnId,
        traceId: review.triggerTraceId,
      },
      scope: {
        userId: review.userId,
        agentId: review.agentId,
        conversationId: review.conversationId,
        sourceTurnIds: evidence.map((item) => item.turnId),
      },
      requests: evidence.map((item) => ({
        turnId: item.turnId,
        userNeed: item.userNeed,
        constraints: item.constraints,
      })),
      executions: evidence.map((item) => ({
        turnId: item.turnId,
        terminalStatus: item.terminalStatus,
        finalResultSummary: item.finalResultSummary,
        toolIterations: item.toolIterations,
        evaluation: item.evaluation,
        toolExecutions: item.toolExecutions,
        artifacts: item.artifacts,
      })),
      skills: {
        loadedSkills,
        relatedSkills,
      },
      feedback: {
        explicitPreferences: this.flattenUnique(evidence, 'explicitPreferences'),
        corrections: this.flattenUnique(evidence, 'corrections'),
        acceptances: this.flattenUnique(evidence, 'acceptances'),
        rejections: this.flattenUnique(evidence, 'rejections'),
      },
      memory: this.uniqueMemories(evidence),
      failures: evidence.flatMap((item) => item.failures),
    };

    this.logger.log({
      level: 'info',
      event: 'grow.focus.context_ready',
      message: 'Prepared detached Grow Focus context.',
      fields: {
        reviewId: review.id,
        sourceTurnCount: evidence.length,
        toolIterationCount: evidence.reduce((sum, item) => sum + item.toolIterations, 0),
        loadedSkillCount: loadedSkills.length,
        relatedSkillCount: relatedSkills.length,
        latestTurnId: latest?.turnId ?? null,
      },
    });

    return context;
  }

  private buildSearchQuery(evidence: GrowTurnEvidence[]): string {
    return evidence
      .flatMap((item) => [
        item.userNeed,
        ...item.constraints,
        ...item.explicitPreferences,
        ...item.corrections,
      ])
      .filter(Boolean)
      .join('\n')
      .slice(0, 12_000);
  }

  private uniqueLoadedSkills(evidence: GrowTurnEvidence[]) {
    const map = new Map<string, GrowTurnEvidence['loadedSkills'][number]>();
    for (const item of evidence) {
      for (const skill of item.loadedSkills) {
        map.set(`${skill.skillId}:${skill.versionId}`, skill);
      }
    }
    return [...map.values()];
  }

  private uniqueMemories(evidence: GrowTurnEvidence[]) {
    const map = new Map<string, GrowTurnEvidence['relevantMemories'][number]>();
    for (const item of evidence) {
      for (const memory of item.relevantMemories) map.set(memory.memoryId, memory);
    }
    return [...map.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 20);
  }

  private flattenUnique<K extends 'explicitPreferences' | 'corrections' | 'acceptances' | 'rejections'>(
    evidence: GrowTurnEvidence[],
    key: K,
  ): string[] {
    return [...new Set(evidence.flatMap((item) => item[key]))].slice(0, 30);
  }
}
