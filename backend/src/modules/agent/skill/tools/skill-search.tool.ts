import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../../../tools/toolstypes';
import { ToolError } from '../../../../tools/toolstypes';
import { SkillSearchService } from '../routing/skill-search.service';
import { SkillTurnContextStore } from '../runtime/skill-turn-context.store';

@Injectable()
export class SkillSearchTool implements Tool {
  readonly name = 'skill_search';
  readonly version = '1.0.0';
  readonly description =
    'Search the authorized active Skill library for capabilities not already present in the current turn catalog. Use skill_view to load a returned Skill before following it.';
  readonly tags = ['skill', 'runtime', 'search'];
  readonly inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500 },
      limit: { type: 'integer', minimum: 1, maximum: 8, default: 5 },
    },
  };
  readonly outputSchema = { type: 'object' };
  readonly sideEffectClass = 'read_only' as const;
  readonly idempotency = 'optional' as const;
  readonly requiresApproval = false;
  readonly providerKind = 'internal' as const;
  readonly capabilityKinds = ['skill.search'];
  readonly sourceTypes: NonNullable<Tool['sourceTypes']> = ['runtime_result'];
  readonly riskLevel = 'low' as const;

  constructor(
    private readonly contexts: SkillTurnContextStore,
    private readonly searchService: SkillSearchService,
  ) {}

  canExecute(ctx: ToolContext): boolean {
    const session = this.contexts.get(ctx.traceId);
    return Boolean(
      session &&
      session.userId === ctx.userId &&
      session.conversationId === ctx.conversationId &&
      session.agentId === String(ctx.metadata?.agentId ?? ''),
    );
  }

  async execute(args: Dict, ctx: ToolContext) {
    const session = this.contexts.get(ctx.traceId);
    if (!session || !ctx.traceId || !this.canExecute(ctx)) {
      throw new ToolError('SKILL_RUNTIME_CONTEXT_MISSING', 'Skill runtime context is not available');
    }
    const query = String(args.query ?? '').trim();
    if (!query) throw new ToolError('SKILL_SEARCH_QUERY_REQUIRED', 'Skill search query is required');
    const limit = Math.max(1, Math.min(8, Math.trunc(Number(args.limit ?? 5) || 5)));
    const entries = await this.searchService.search({
      userId: session.userId,
      query,
      limit,
      excludeSkillIds: session.internalCatalog.map((entry) => entry.id),
    });
    const appended = this.contexts.appendCandidates(ctx.traceId, entries);
    return {
      query,
      results: appended.map((entry) => ({
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
        relevance: entry.relevance,
      })),
    };
  }
}
