import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AgentProfileContextService } from '../../../seekmore-agent/context/agent-profile-context.service';
import type {
  AgentRuntimeMessage,
  AgentRuntimeTurnRequest,
  AgentTurnExecutionResult,
} from '../../../seekmore-agent/contracts/agent-turn.types';
import { AgentTurnRepository } from '../../../seekmore-agent/persistence/agent-turn.repository';
import { AgentRuntimeService } from '../../../seekmore-agent/runtime/agent-runtime.service';
import { AgentToolRuntimeService } from '../../../seekmore-agent/tools/agent-tool-runtime.service';
import { SkillTurnPreparationService } from '../../../agent/skill/runtime/skill-turn-preparation.service';
import { SkillTurnContextStore } from '../../../agent/skill/runtime/skill-turn-context.store';
import { LocaleResolverService } from '../../../localization/locale-resolver.service';
import { GrowError } from '../../domain/grow.errors';
import type { GrowFocusResult } from '../../domain/grow.types';
import type { GrowFocusAgentPort } from '../../ports/grow-focus-agent.port';

@Injectable()
export class SeekmoreGrowFocusAgentAdapter implements GrowFocusAgentPort {
  constructor(
    private readonly profiles: AgentProfileContextService,
    private readonly runtime: AgentRuntimeService,
    private readonly tools: AgentToolRuntimeService,
    private readonly turns: AgentTurnRepository,
    private readonly skillPreparation: SkillTurnPreparationService,
    private readonly skillContexts: SkillTurnContextStore,
    private readonly localeResolver: LocaleResolverService,
  ) {}

  async run(input: Parameters<GrowFocusAgentPort['run']>[0]): Promise<GrowFocusResult> {
    const traceId = `grow-focus:${input.context.reviewId}:${randomUUID()}`;
    const userMessageId = `grow-user:${randomUUID()}`;
    const assistantMessageId = `grow-assistant:${randomUUID()}`;
    const profile = await this.profiles.load({
      userId: input.context.scope.userId,
      agentId: input.context.scope.agentId,
    });
    const explicitSkillIds = [...new Set([
      ...input.context.skills.loadedSkills.map((skill) => skill.skillId),
      ...input.context.skills.relatedSkills.map((skill) => skill.skillId),
    ])];
    const skillContext = await this.skillPreparation.prepare({
      traceId,
      userId: input.context.scope.userId,
      agentId: input.context.scope.agentId,
      conversationId: input.context.scope.conversationId,
      userMessage: this.contextQuery(input.context),
      externalContext: { explicitSkillIds },
    });
    this.skillContexts.set(skillContext);

    const definitions = await this.tools.listDefinitionsForUser({
      userId: input.context.scope.userId,
      agentId: input.context.scope.agentId,
      toolEnabled: true,
      workspaceRoot: null,
      enabledToolNames: input.toolNames,
      disabledToolNames: [],
    });
    const allowed = new Set(input.toolNames);
    const localization = await this.localeResolver.resolveForBackground({
      conversationId: input.context.scope.conversationId,
    });
    const request: AgentRuntimeTurnRequest = {
      traceId,
      userId: input.context.scope.userId,
      agentId: input.context.scope.agentId,
      conversationId: input.context.scope.conversationId,
      userMessageId,
      assistantMessageId,
      parentMessageId: null,
      branchId: null,
      input: this.focusInput(input.context),
      localization,
      messages: [] as AgentRuntimeMessage[],
      agent: {
        name: `${profile.name} Grow Focus`,
        instructions: input.systemPrompt,
        model: profile.model,
        provider: profile.provider,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        temperature: profile.temperature ?? 0.1,
        maxTokens: Math.min(input.tokenBudget, profile.maxTokens ?? input.tokenBudget),
        apiMode: profile.apiMode,
        contextWindow: profile.contextWindow,
        reasoningEffort: profile.reasoningEffort,
        headers: profile.headers,
        protocol: profile.protocol,
        capabilities: profile.modelCapabilities,
        fallbacks: profile.fallbacks,
      },
      workspace: {
        workspaceId: null,
        rootPath: null,
        readAllowed: false,
        writeAllowed: false,
      },
      permissionMode: 'confirm_required',
      accessPolicyVersion: 1,
      tools: definitions.filter((definition) => allowed.has(definition.name)),
      attachedObjects: [],
      maxIterations: Math.max(1, Math.min(input.maxIterations, 20)),
      timeouts: {
        firstToken: Math.max(30, Math.ceil(input.timeoutMs / 1000)),
        idle: Math.max(30, Math.ceil(input.timeoutMs / 1000)),
        modelTotal: Math.max(30, Math.ceil(input.timeoutMs / 1000)),
        tool: Math.max(15, Math.ceil(input.timeoutMs / 1000)),
      },
      executionContext: {
        kind: 'grow_focus',
        reviewId: input.context.reviewId,
      },
    };

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error('GROW_FOCUS_TIMEOUT')), input.timeoutMs);
    timer.unref?.();
    let terminalPersisted = false;
    await this.turns.start(request);
    try {
      const execution = await this.runtime.run(request, { signal: abort.signal });
      const result: AgentTurnExecutionResult = {
        traceId,
        conversationId: request.conversationId,
        userMessageId,
        assistantMessageId,
        content: execution.content,
        citations: execution.citations,
        objects: execution.objects,
        runtime: {
          engine: 'seekmore-agent-runtime-ts',
          executionContext: request.executionContext,
          iterations: execution.iterations,
          toolCallCount: execution.toolCallCount,
          toolExecutions: execution.toolExecutions,
          usage: execution.usage,
        },
        metadata: execution.metadata,
        warnings: execution.warnings,
        reasonCodes: execution.reasonCodes,
        outcome: execution.outcome,
      };
      await this.turns.complete(traceId, result);
      terminalPersisted = true;
      if (execution.outcome.kind !== 'terminal' || execution.outcome.status === 'failed' || execution.outcome.status === 'blocked') {
        throw new Error(`GROW_FOCUS_RUNTIME_${execution.outcome.kind === 'terminal' ? execution.outcome.status.toUpperCase() : 'PAUSED'}`);
      }
      return this.parse(execution.content);
    } catch (error) {
      if (!terminalPersisted) {
        await this.turns.fail(traceId, error).catch(() => undefined);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.skillContexts.clear(traceId);
    }
  }

  private focusInput(context: Parameters<GrowFocusAgentPort['run']>[0]['context']): string {
    return [
      'Review the following sanitized evidence. Return exactly one JSON object matching GrowFocusResult.',
      'The entire answer must be directly parseable by JSON.parse. Do not use Markdown fences, prose before or after the JSON, comments, or a second JSON value.',
      'Common result shape:',
      JSON.stringify({
        worthLearning: true,
        summary: 'brief review summary',
        actions: [{
          action: 'IGNORE | CREATE_SKILL | CREATE_VERSION | UPDATE_ROUTE | ADD_RESOURCE | WRITE_MEMORY | EMBED_PREFERENCE | REQUEST_STUDY',
          title: 'capability title',
          reusableGoal: 'stable reusable goal',
          reusableMethod: ['step'],
          validationRules: ['rule'],
          reason: 'evidence-based reason',
          confidence: 0.9,
          reasonTypes: ['SUCCESSFUL_EXPERIENCE'],
          category: 'optional dynamic category',
          tags: ['tag'],
          routeKeywords: ['term'],
        }],
      }),
      'Action-specific fields. Include only fields that apply to the selected action:',
      JSON.stringify({
        CREATE_SKILL: {
          routingProfile: {
            aliases: [],
            positiveTerms: [],
            negativeTerms: [],
            toolNames: [],
            capabilityKinds: [],
            fileExtensions: [],
            artifactTypes: [],
          },
          skillMarkdown: 'complete SKILL.md',
          resources: [],
        },
        CREATE_VERSION: {
          targetSkillId: 'existing Skill id',
          skillMarkdown: 'complete SKILL.md',
          routingProfile: {
            aliases: [],
            positiveTerms: [],
            negativeTerms: [],
            toolNames: [],
            capabilityKinds: [],
            fileExtensions: [],
            artifactTypes: [],
          },
          resources: [],
        },
        UPDATE_ROUTE: {
          targetSkillId: 'existing Skill id',
          routingProfile: {
            aliases: [],
            positiveTerms: [],
            negativeTerms: [],
            toolNames: [],
            capabilityKinds: [],
            fileExtensions: [],
            artifactTypes: [],
          },
        },
        ADD_RESOURCE: {
          targetSkillId: 'existing Skill id',
          resources: [{
            path: 'relative/path.ext',
            mimeType: 'text/plain',
            textContent: 'resource content',
            executable: false,
          }],
        },
        WRITE_MEMORY: {
          memoryStatement: 'stable memory statement',
        },
        EMBED_PREFERENCE: {
          targetSkillId: 'existing Skill id',
          skillMarkdown: 'complete SKILL.md',
          routingProfile: {
            aliases: [],
            positiveTerms: [],
            negativeTerms: [],
            toolNames: [],
            capabilityKinds: [],
            fileExtensions: [],
            artifactTypes: [],
          },
          resources: [],
        },
        REQUEST_STUDY: {
          studyRequest: {
            question: 'material professional question',
            context: 'why the study is needed',
            preferredSourceTypes: [],
          },
        },
        IGNORE: {},
      }),
      'Omit action-specific fields that do not apply. Do not emit null values, empty placeholder objects, or placeholder fields for unrelated action types.',
      'Before returning, verify that JSON.parse(finalAnswer) would succeed and that the final answer contains exactly one top-level JSON object.',
      'Sanitized context:',
      JSON.stringify(context),
    ].join('\n\n');
  }

  private contextQuery(context: Parameters<GrowFocusAgentPort['run']>[0]['context']): string {
    return context.requests.flatMap((request) => [request.userNeed, ...request.constraints]).join('\n').slice(0, 12_000);
  }

  private parse(content: string): GrowFocusResult {
    const raw = String(content ?? '').trim();
    const unfenced = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const exact = this.tryParseJson(unfenced);
    if (exact !== undefined) {
      return exact as GrowFocusResult;
    }

    const parsedCandidates: unknown[] = [];
    for (const candidate of this.jsonObjectCandidates(unfenced)) {
      const parsed = this.tryParseJson(candidate);
      if (parsed !== undefined) {
        parsedCandidates.push(parsed);
      }
    }

    const growResult = [...parsedCandidates]
      .reverse()
      .find((candidate) => this.looksLikeGrowFocusResult(candidate));

    if (growResult !== undefined) {
      return growResult as GrowFocusResult;
    }

    const fallback = parsedCandidates[parsedCandidates.length - 1];
    if (fallback !== undefined) {
      return fallback as GrowFocusResult;
    }

    throw new GrowError(
      'GROW_FOCUS_JSON_PARSE_FAILED',
      'Grow Focus did not return one parseable JSON object.',
      true,
    );
  }

  private tryParseJson(value: string): unknown | undefined {
    if (!value) return undefined;

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  private jsonObjectCandidates(value: string): string[] {
    const candidates: string[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];

      if (start < 0) {
        if (character === '{') {
          start = index;
          depth = 1;
          inString = false;
          escaped = false;
        }
        continue;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (character === '\\') {
          escaped = true;
          continue;
        }

        if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }

      if (character === '{') {
        depth += 1;
        continue;
      }

      if (character !== '}') {
        continue;
      }

      depth -= 1;
      if (depth !== 0) {
        continue;
      }

      candidates.push(value.slice(start, index + 1));
      start = -1;
      inString = false;
      escaped = false;
    }

    return candidates;
  }

  private looksLikeGrowFocusResult(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const record = value as Record<string, unknown>;
    return (
      typeof record.worthLearning === 'boolean' &&
      typeof record.summary === 'string' &&
      Array.isArray(record.actions)
    );
  }
}
