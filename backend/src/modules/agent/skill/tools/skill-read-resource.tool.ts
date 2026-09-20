import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../../../tools/toolstypes';
import { ToolError } from '../../../../tools/toolstypes';
import { SkillTurnContextStore } from '../runtime/skill-turn-context.store';
import { SkillResourceLoaderService } from '../loading/skill-resource-loader.service';

@Injectable()
export class SkillReadResourceTool implements Tool {
  readonly name = 'skill_read_resource';
  readonly version = '2.0.0';
  readonly description =
    'Read one resource by relative path from a Skill already loaded with skill_view. This tool never executes scripts.';
  readonly tags = ['skill', 'runtime', 'read'];
  readonly inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'path'],
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      },
      path: { type: 'string', minLength: 1, maxLength: 500 },
    },
  };
  readonly outputSchema = { type: 'object' };
  readonly sideEffectClass = 'read_only' as const;
  readonly idempotency = 'optional' as const;
  readonly requiresApproval = false;
  readonly providerKind = 'internal' as const;
  readonly capabilityKinds = ['skill.resource.read'];
  readonly sourceTypes: NonNullable<Tool['sourceTypes']> = ['runtime_result'];
  readonly riskLevel = 'low' as const;

  constructor(
    private readonly contexts: SkillTurnContextStore,
    private readonly resources: SkillResourceLoaderService,
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
    if (
      !session ||
      !ctx.traceId ||
      session.userId !== ctx.userId ||
      session.conversationId !== ctx.conversationId ||
      session.agentId !== String(ctx.metadata?.agentId ?? '')
    ) {
      throw new ToolError(
        'SKILL_RUNTIME_CONTEXT_MISSING',
        'Skill runtime context is not available',
      );
    }

    const name = String(args.name ?? '').trim();
    const skillId = session.allowedSkillIdsByName.get(name);
    const versionId = skillId ? session.allowedVersions.get(skillId) : undefined;
    if (!skillId || !versionId || !session.loadedVersions.has(versionId)) {
      throw new ToolError(
        'SKILL_RESOURCE_NOT_ALLOWED',
        'Load the Skill with skill_view before reading its resources',
      );
    }

    const resource = await this.resources.load(
      skillId,
      versionId,
      String(args.path ?? ''),
    );
    if (!this.contexts.consumeResource(ctx.traceId, versionId, resource.tokenEstimate)) {
      throw new ToolError(
        'SKILL_RESOURCE_BUDGET_EXCEEDED',
        'Skill resource budget exceeded',
      );
    }
    return resource;
  }
}
