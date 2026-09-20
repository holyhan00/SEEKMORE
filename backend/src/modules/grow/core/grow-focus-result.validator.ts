import { GROW_MAX_ACTIONS } from '../domain/grow.constants';
import { GrowInvariantError } from '../domain/grow.errors';
import type {
  GrowActionType,
  GrowFocusAction,
  GrowFocusResult,
  GrowRoutingProfile,
} from '../domain/grow.types';

const ACTIONS = new Set<GrowActionType>([
  'IGNORE',
  'CREATE_SKILL',
  'CREATE_VERSION',
  'UPDATE_ROUTE',
  'ADD_RESOURCE',
  'WRITE_MEMORY',
  'EMBED_PREFERENCE',
  'REQUEST_STUDY',
]);

const EXISTING_SKILL_ACTIONS = new Set<GrowActionType>([
  'CREATE_VERSION',
  'UPDATE_ROUTE',
  'ADD_RESOURCE',
  'EMBED_PREFERENCE',
]);

const ROUTING_PROFILE_ACTIONS = new Set<GrowActionType>([
  'CREATE_SKILL',
  'CREATE_VERSION',
  'UPDATE_ROUTE',
  'EMBED_PREFERENCE',
]);

const SKILL_MARKDOWN_ACTIONS = new Set<GrowActionType>([
  'CREATE_SKILL',
  'CREATE_VERSION',
  'EMBED_PREFERENCE',
]);

const RESOURCE_ACTIONS = new Set<GrowActionType>([
  'CREATE_SKILL',
  'CREATE_VERSION',
  'ADD_RESOURCE',
  'EMBED_PREFERENCE',
]);

export class GrowFocusResultValidator {
  validate(value: unknown, maximumActions = GROW_MAX_ACTIONS): GrowFocusResult {
    if (!this.record(value)) {
      throw new GrowInvariantError(
        'GROW_FOCUS_RESULT_INVALID',
        'Grow Focus result must be an object.',
      );
    }

    if (typeof value.worthLearning !== 'boolean') {
      throw new GrowInvariantError(
        'GROW_FOCUS_RESULT_WORTH_LEARNING_INVALID',
        'worthLearning must be boolean.',
      );
    }
    if (typeof value.summary !== 'string') {
      throw new GrowInvariantError(
        'GROW_FOCUS_RESULT_SUMMARY_INVALID',
        'summary must be string.',
      );
    }
    if (!Array.isArray(value.actions)) {
      throw new GrowInvariantError(
        'GROW_FOCUS_RESULT_ACTIONS_INVALID',
        'actions must be an array.',
      );
    }
    if (value.actions.length > maximumActions) {
      throw new GrowInvariantError(
        'GROW_FOCUS_RESULT_TOO_MANY_ACTIONS',
        `Grow Focus returned ${value.actions.length} actions; maximum is ${maximumActions}.`,
      );
    }

    const parsed = value.actions.map((action, index) => this.action(action, index));
    if (!value.worthLearning && parsed.some((item) => item.action !== 'IGNORE')) {
      throw new GrowInvariantError(
        'GROW_FOCUS_RESULT_CONTRADICTORY',
        'worthLearning=false cannot include mutating Grow actions.',
      );
    }

    return {
      worthLearning: value.worthLearning,
      summary: value.summary.trim(),
      actions: parsed,
    };
  }

  private action(value: unknown, index: number): GrowFocusAction {
    if (!this.record(value)) {
      throw new GrowInvariantError(
        'GROW_FOCUS_ACTION_INVALID',
        `Action ${index} must be an object.`,
      );
    }

    const action = String(value.action ?? '') as GrowActionType;
    if (!ACTIONS.has(action)) {
      throw new GrowInvariantError(
        'GROW_FOCUS_ACTION_TYPE_INVALID',
        `Action ${index} has unsupported type ${action}.`,
      );
    }

    return {
      action,
      title: this.requiredString(value.title, `actions[${index}].title`),
      reusableGoal: this.requiredString(
        value.reusableGoal,
        `actions[${index}].reusableGoal`,
      ),
      reusableMethod: this.stringArray(value.reusableMethod),
      validationRules: this.stringArray(value.validationRules),
      reason: this.requiredString(value.reason, `actions[${index}].reason`),
      confidence: this.confidence(value.confidence),
      reasonTypes: this.stringArray(value.reasonTypes) as GrowFocusAction['reasonTypes'],
      targetSkillId: EXISTING_SKILL_ACTIONS.has(action)
        ? this.optionalString(value.targetSkillId)
        : undefined,
      category: this.optionalString(value.category),
      tags: this.stringArray(value.tags),
      routeKeywords: this.stringArray(value.routeKeywords),
      routingProfile: ROUTING_PROFILE_ACTIONS.has(action)
        ? this.routingProfile(value.routingProfile)
        : undefined,
      skillMarkdown: SKILL_MARKDOWN_ACTIONS.has(action)
        ? this.optionalString(value.skillMarkdown)
        : undefined,
      resources: RESOURCE_ACTIONS.has(action)
        ? this.resources(value.resources)
        : [],
      memoryStatement: action === 'WRITE_MEMORY'
        ? this.optionalString(value.memoryStatement)
        : undefined,
      studyRequest: action === 'REQUEST_STUDY'
        ? this.studyRequest(value.studyRequest)
        : undefined,
      professionalSources: Array.isArray(value.professionalSources)
        ? (value.professionalSources as GrowFocusAction['professionalSources'])
        : [],
    };
  }

  private resources(value: unknown): GrowFocusAction['resources'] {
    if (!Array.isArray(value)) return [];

    return value
      .filter((item) => this.record(item))
      .map((item) => ({
        path: this.requiredString(item.path, 'resource.path'),
        mimeType: this.requiredString(item.mimeType, 'resource.mimeType'),
        textContent: this.requiredString(item.textContent, 'resource.textContent'),
        executable: Boolean(item.executable),
      }));
  }

  private studyRequest(
    value: unknown,
  ): GrowFocusAction['studyRequest'] {
    if (!this.record(value)) return undefined;

    const question = this.optionalString(value.question);
    const context = this.optionalString(value.context);
    if (!question || !context) {
      return undefined;
    }

    return {
      question,
      context,
      preferredSourceTypes: this.stringArray(
        value.preferredSourceTypes,
      ) as NonNullable<GrowFocusAction['studyRequest']>['preferredSourceTypes'],
    };
  }

  private routingProfile(value: unknown): GrowRoutingProfile | undefined {
    if (!this.record(value)) return undefined;
    return {
      aliases: this.stringArray(value.aliases),
      positiveTerms: this.weightedTerms(value.positiveTerms),
      negativeTerms: this.weightedTerms(value.negativeTerms),
      toolNames: this.stringArray(value.toolNames),
      capabilityKinds: this.stringArray(value.capabilityKinds),
      fileExtensions: this.stringArray(value.fileExtensions),
      artifactTypes: this.stringArray(value.artifactTypes),
    };
  }

  private weightedTerms(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => this.record(item))
      .map((item) => ({
        term: String(item.term ?? '').trim(),
        weight: Math.max(0, Math.min(1, Number(item.weight ?? 0.5))),
      }))
      .filter((item) => item.term.length > 0);
  }

  private confidence(value: unknown): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
  }

  private requiredString(value: unknown, path: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
      throw new GrowInvariantError(
        'GROW_FOCUS_REQUIRED_FIELD_MISSING',
        `${path} is required.`,
      );
    }
    return text;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  }

  private record(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }
}
