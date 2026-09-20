import { GROW_PROTECTED_SOURCES } from '../domain/grow.constants';
import { GrowInvariantError } from '../domain/grow.errors';
import type {
  GrowFocusAction,
  GrowFocusContext,
  GrowFocusResult,
} from '../domain/grow.types';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowPolicy } from './grow-policy';

const ONE_OFF_PATTERNS = [
  /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/,
  /\b(?:today|tomorrow|yesterday|this time|for this task)\b/i,
  /\b(?:fix|debug|audit)-[a-z0-9_-]+\b/i,
  /\bPR\s*#?\d+\b/i,
];

const UPDATE_ACTIONS = new Set<GrowFocusAction['action']>([
  'CREATE_VERSION',
  'UPDATE_ROUTE',
  'ADD_RESOURCE',
  'EMBED_PREFERENCE',
]);

export class GrowDecisionGuardService {
  constructor(
    private readonly policy: GrowPolicy,
    private readonly logger: GrowLoggerPort,
  ) {}

  guard(result: GrowFocusResult, context: GrowFocusContext): GrowFocusResult {
    const accepted: GrowFocusAction[] = [];

    for (const action of result.actions.slice(0, this.policy.focus.maximumActions)) {
      const rejection = this.rejectionReason(action, context);
      if (rejection) {
        this.logger.log({
          level: 'warn',
          event: 'grow.action.rejected',
          message: rejection,
          fields: {
            reviewId: context.reviewId,
            action: action.action,
            title: action.title,
            targetSkillId: action.targetSkillId ?? null,
          },
        });
        continue;
      }
      accepted.push(action);
    }

    return {
      worthLearning: accepted.some((action) => action.action !== 'IGNORE'),
      summary: result.summary,
      actions: accepted,
    };
  }

  private rejectionReason(
    action: GrowFocusAction,
    context: GrowFocusContext,
  ): string | null {
    if (action.confidence < 0.55 && action.action !== 'IGNORE') {
      return 'Grow action confidence is below the minimum authoring threshold.';
    }

    if (ONE_OFF_PATTERNS.some((pattern) => pattern.test(action.title))) {
      return 'Grow action title appears session-specific or one-off.';
    }

    if (
      ['CREATE_SKILL', 'CREATE_VERSION', 'EMBED_PREFERENCE'].includes(action.action) &&
      !action.skillMarkdown?.trim()
    ) {
      return 'Skill authoring action did not provide complete SKILL.md content.';
    }

    if (action.action === 'WRITE_MEMORY' && !action.memoryStatement?.trim()) {
      return 'WRITE_MEMORY requires a stable memory statement.';
    }

    if (action.action === 'REQUEST_STUDY' && !action.studyRequest) {
      return 'REQUEST_STUDY requires a professional study request.';
    }

    if (UPDATE_ACTIONS.has(action.action)) {
      if (!action.targetSkillId) {
        return 'Updating an existing Skill requires targetSkillId.';
      }

      const target = [
        ...context.skills.loadedSkills,
        ...context.skills.relatedSkills,
      ].find((skill) => skill.skillId === action.targetSkillId);

      if (!target) return 'Target Skill was not present in the reviewed Skill context.';
      if (target.locked && !this.policy.authoring.allowUpdateLockedSkills) {
        return 'Target Skill is locked against automatic Grow updates.';
      }
      if (target.protected) return 'Target Skill is protected.';
      if (
        target.source &&
        GROW_PROTECTED_SOURCES.has(target.source.toUpperCase()) &&
        !this.policy.authoring.allowUpdateBuiltinSkills
      ) {
        return 'Target Skill source is protected from automatic Grow updates.';
      }
      if (!this.policy.authoring.allowUpdateUserSkills) {
        return 'Automatic updates to user Skills are disabled by policy.';
      }
    }

    if (action.action === 'CREATE_SKILL') {
      if (!action.routingProfile) return 'CREATE_SKILL requires a routing profile.';
      if (!action.tags.length) return 'CREATE_SKILL requires at least one classification tag.';
    }

    if (action.action === 'UPDATE_ROUTE' && !action.routingProfile) {
      return 'UPDATE_ROUTE requires a complete routing profile.';
    }

    if (action.action === 'ADD_RESOURCE' && !(action.resources?.length ?? 0)) {
      return 'ADD_RESOURCE requires one or more resources.';
    }

    return null;
  }

  assertNoUnsafeSecrets(text: string): void {
    const valuePatterns = [
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?key|authorization|cookie)\b\s*[:=]\s*[^\s,;`]+/i,
      /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
      /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/,
    ];

    if (valuePatterns.some((pattern) => pattern.test(text))) {
      throw new GrowInvariantError(
        'GROW_DRAFT_CONTAINS_SENSITIVE_VALUE',
        'Generated Skill content appears to contain a credential or secret value.',
      );
    }
  }
}
