import { Injectable } from '@nestjs/common';
import { SkillActivationSource, SkillUsageOutcome } from '@prisma/client';
import type { Dict, Tool, ToolContext } from '../../../../tools/toolstypes';
import { ToolError } from '../../../../tools/toolstypes';
import { SkillTurnContextStore } from '../runtime/skill-turn-context.store';
import { SkillLoaderService } from '../loading/skill-loader.service';
import { SkillUsageRecorderService } from '../usage/skill-usage-recorder.service';
import { estimateTokens } from '../domain/skill-content.util';
import { SkillResolverService } from '../resolution/skill-resolver.service';

@Injectable()
export class SkillViewTool implements Tool {
  readonly name = 'skill_view';
  readonly version = '2.0.0';
  readonly description =
    'Load the complete SKILL.md instructions for one Skill from the current turn catalog by its standard Skill name.';
  readonly tags = ['skill', 'runtime', 'read'];
  readonly inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      },
    },
  };
  readonly outputSchema = { type: 'object' };
  readonly sideEffectClass = 'read_only' as const;
  readonly idempotency = 'optional' as const;
  readonly requiresApproval = false;
  readonly providerKind = 'internal' as const;
  readonly capabilityKinds = ['skill.load'];
  readonly sourceTypes: NonNullable<Tool['sourceTypes']> = ['runtime_result'];
  readonly riskLevel = 'low' as const;

  constructor(
    private readonly contexts: SkillTurnContextStore,
    private readonly loader: SkillLoaderService,
    private readonly usage: SkillUsageRecorderService,
    private readonly resolver: SkillResolverService,
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
    if (!session || !ctx.traceId) {
      throw new ToolError(
        'SKILL_RUNTIME_CONTEXT_MISSING',
        'Skill runtime context is not available',
      );
    }

    const name = String(args.name ?? '').trim();
    const decision = this.resolver.resolve(session, name);
    const rejection = decision.rejectedSkills[0];
    if (rejection) throw new ToolError(rejection.code, rejection.reason);

    const entry = session.internalCatalog.find((item) => item.name === name);
    if (!entry) {
      throw new ToolError(
        'SKILL_NOT_ALLOWED_THIS_TURN',
        'Skill is not available in the current turn catalog',
      );
    }
    if (!this.contexts.allowSkillLoad(ctx.traceId, name)) {
      throw new ToolError(
        'SKILL_AUTOMATIC_LOAD_LIMIT',
        'Maximum automatic Skill loads reached for this turn',
      );
    }

    const loaded = await this.loader.load({
      skillId: entry.id,
      versionId: entry.versionId,
      activationMode: entry.activationMode,
      source: entry.source,
      userId: session.userId,
      agentId: session.agentId,
    });
    this.contexts.markLoaded(ctx.traceId, name, entry.versionId);

    await this.usage.record({
      skillId: entry.id,
      skillVersionId: entry.versionId,
      userId: session.userId,
      agentId: session.agentId,
      conversationId: session.conversationId,
      traceId: session.traceId,
      activationMode: entry.activationMode,
      activationSource: this.source(entry.source),
      outcome: SkillUsageOutcome.LOADED,
      confidence: entry.relevance,
      tokenEstimate: estimateTokens(loaded.instructions),
      dependencyStatus: loaded.dependencies,
    });
    return this.loader.expose(loaded);
  }

  private source(source: string): SkillActivationSource {
    if (source === 'USER_EXPLICIT') return SkillActivationSource.USER_EXPLICIT;
    if (source === 'SESSION') return SkillActivationSource.SESSION_OVERRIDE;
    if (source === 'DISCOVERABLE') return SkillActivationSource.PUBLIC_RELEVANCE;
    return SkillActivationSource.AGENT_BINDING;
  }
}
