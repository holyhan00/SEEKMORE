import {
  GROW_GENERATOR_VERSION,
  GROW_POLICY_VERSION,
} from '../domain/grow.constants';
import { GrowInvariantError } from '../domain/grow.errors';
import type {
  GrowDraftProvenance,
  GrowDraftResult,
  GrowFocusAction,
  GrowFocusContext,
  GrowProfessionalSourceSummary,
  GrowPublishedSkillSnapshot,
  GrowReviewRecord,
} from '../domain/grow.types';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowMemoryPort } from '../ports/grow-memory.port';
import type { GrowSkillAuthoringPort } from '../ports/grow-skill-authoring.port';
import type { GrowSkillCatalogPort } from '../ports/grow-skill-catalog.port';
import { GrowDecisionGuardService } from './grow-decision-guard.service';

export class GrowActionExecutorService {
  constructor(
    private readonly authoring: GrowSkillAuthoringPort,
    private readonly catalog: GrowSkillCatalogPort,
    private readonly memory: GrowMemoryPort,
    private readonly guard: GrowDecisionGuardService,
    private readonly logger: GrowLoggerPort,
  ) {}

  async execute(input: {
    review: GrowReviewRecord;
    context: GrowFocusContext;
    action: GrowFocusAction;
  }): Promise<GrowDraftResult | null> {
    const { review, context, action } = input;

    this.logger.log({
      level: 'info',
      event: 'grow.action.execute_start',
      message: `Executing Grow action ${action.action}.`,
      fields: {
        reviewId: review.id,
        action: action.action,
        title: action.title,
        targetSkillId: action.targetSkillId ?? null,
      },
    });

    if (action.action === 'IGNORE' || action.action === 'REQUEST_STUDY') {
      return null;
    }

    if (action.action === 'WRITE_MEMORY') {
      await this.memory.write({
        userId: review.userId,
        agentId: review.agentId,
        statement: action.memoryStatement ?? action.reusableGoal,
        sourceReviewId: review.id,
        confidence: action.confidence,
      });
      this.logger.log({
        level: 'info',
        event: 'grow.memory.written',
        message: 'Persisted stable preference or project fact through the Memory port.',
        fields: { reviewId: review.id, title: action.title },
      });
      return null;
    }

    if (action.action === 'CREATE_SKILL') {
      this.guard.assertNoUnsafeSecrets(action.skillMarkdown ?? '');
      return this.authoring.createSkillDraft({
        ownerUserId: review.userId,
        reviewId: review.id,
        name: this.internalName(action.title),
        displayName: action.title,
        description: action.reusableGoal,
        category: action.category,
        tags: action.tags,
        skillMarkdown: action.skillMarkdown ?? '',
        resources: action.resources ?? [],
        routingProfile: action.routingProfile ?? this.defaultRoutingProfile(action),
        provenance: this.provenance(review, context, action),
      });
    }

    const current = await this.requireCurrentPublished(review, action);
    const provenance = this.provenance(review, context, action, current);

    this.logger.log({
      level: 'info',
      event: 'grow.skill.base_read',
      message: 'Read the latest published Skill version before creating a new immutable version.',
      fields: {
        reviewId: review.id,
        skillId: current.skillId,
        baseVersionId: current.versionId,
        baseContentHash: current.contentHash,
      },
    });

    if (action.action === 'CREATE_VERSION' || action.action === 'EMBED_PREFERENCE') {
      this.guard.assertNoUnsafeSecrets(action.skillMarkdown ?? '');
      return this.authoring.createVersionDraft({
        ownerUserId: review.userId,
        reviewId: review.id,
        skillId: current.skillId,
        baseVersionId: current.versionId,
        baseContentHash: current.contentHash,
        skillMarkdown: action.skillMarkdown ?? '',
        changeLog: action.reason,
        resources: action.resources ?? [],
        routingProfile: action.routingProfile,
        provenance,
      });
    }

    if (action.action === 'UPDATE_ROUTE') {
      return this.authoring.updateRouteDraft({
        ownerUserId: review.userId,
        reviewId: review.id,
        skillId: current.skillId,
        baseVersionId: current.versionId,
        baseContentHash: current.contentHash,
        routingProfile: action.routingProfile ?? this.defaultRoutingProfile(action),
        provenance,
      });
    }

    if (action.action === 'ADD_RESOURCE') {
      for (const resource of action.resources ?? []) {
        this.guard.assertNoUnsafeSecrets(resource.textContent);
      }
      return this.authoring.addResourceDraft({
        ownerUserId: review.userId,
        reviewId: review.id,
        skillId: current.skillId,
        baseVersionId: current.versionId,
        baseContentHash: current.contentHash,
        resources: action.resources ?? [],
        provenance,
      });
    }

    throw new GrowInvariantError(
      'GROW_ACTION_NOT_EXECUTABLE',
      `Unsupported Grow action ${action.action}.`,
    );
  }

  private async requireCurrentPublished(
    review: GrowReviewRecord,
    action: GrowFocusAction,
  ): Promise<GrowPublishedSkillSnapshot> {
    if (!action.targetSkillId) {
      throw new GrowInvariantError(
        'GROW_EXISTING_SKILL_TARGET_MISSING',
        `${action.action} requires targetSkillId.`,
      );
    }
    const current = await this.catalog.readPublished({
      userId: review.userId,
      skillId: action.targetSkillId,
    });
    if (!current) {
      throw new GrowInvariantError(
        'GROW_PUBLISHED_SKILL_NOT_FOUND',
        `Published Skill ${action.targetSkillId} was not found.`,
      );
    }
    return current;
  }

  private provenance(
    review: GrowReviewRecord,
    context: GrowFocusContext,
    action: GrowFocusAction,
    current?: GrowPublishedSkillSnapshot,
  ): GrowDraftProvenance {
    return {
      origin: 'GROW_FOCUS',
      reviewId: review.id,
      triggerTraceId: review.triggerTraceId,
      sourceTurnIds: context.scope.sourceTurnIds,
      baseVersionId: current?.versionId,
      reasonTypes: action.reasonTypes,
      memoryIds: context.memory.map((item) => item.memoryId),
      professionalSources: this.professionalSources(context, action),
      generatorVersion: GROW_GENERATOR_VERSION,
      policyVersion: GROW_POLICY_VERSION,
    };
  }

  private professionalSources(
    context: GrowFocusContext,
    action: GrowFocusAction,
  ): GrowProfessionalSourceSummary[] {
    const all = [
      ...(action.professionalSources ?? []),
      ...(context.professionalStudy ?? []).flatMap((study) => study.findings),
    ];
    const map = new Map<string, GrowProfessionalSourceSummary>();
    for (const source of all) {
      map.set(`${source.sourceType}:${source.title}:${source.publisher ?? ''}`, source);
    }
    return [...map.values()].slice(0, 20);
  }

  private internalName(title: string): string {
    const value = title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    if (value) return value;
    return `grow-skill-${this.hash(title)}`;
  }

  private hash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).slice(0, 10);
  }

  private defaultRoutingProfile(action: GrowFocusAction) {
    return {
      aliases: action.routeKeywords.slice(0, 8),
      positiveTerms: action.routeKeywords.slice(0, 20).map((term) => ({
        term,
        weight: 0.7,
      })),
      negativeTerms: [],
      toolNames: [],
      capabilityKinds: [],
      fileExtensions: [],
      artifactTypes: [],
    };
  }
}
