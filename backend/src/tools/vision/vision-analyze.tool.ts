import { Injectable } from '@nestjs/common';
import { EffectiveMediaRouteService } from '../../modules/llm-settings/application/effective-media-route.service';
import { VisionService } from '../../modules/media-ai/vision/vision.service';
import type { Dict, Tool, ToolContext } from '../toolstypes';

@Injectable()
export class VisionAnalyzeTool implements Tool {
  name = 'vision.analyze';
  version = '1.0.0';
  description = 'Read and analyze owned image RuntimeObjects when the task depends on their visual content.';
  tags = ['vision', 'image', 'object'];
  timeoutMs = 180_000;
  providerKind = 'object' as const;
  capabilityKinds = ['vision.analyze', 'object.image.analyze'];
  sideEffectClass = 'read_only' as const;
  idempotency = 'optional' as const;
  requiresApproval = false;
  inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['objectIds', 'instruction'],
    properties: {
      objectIds: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', minLength: 1 },
      },
      instruction: { type: 'string', minLength: 1, maxLength: 20_000 },
    },
  };

  constructor(
    private readonly routes: EffectiveMediaRouteService,
    private readonly vision: VisionService,
  ) {}

  async canExecute(ctx: ToolContext): Promise<boolean> {
    if (!ctx.userId || !ctx.metadata?.agentId) return false;
    return (await this.routes.get(ctx.userId)).vision.status === 'available';
  }

  async execute(args: Dict, ctx: ToolContext, signal?: AbortSignal) {
    const model = await this.routes.resolveVisionExecution(ctx.userId);
    return this.vision.analyze({
      traceId: ctx.traceId,
      assistantMessageId: ctx.assistantMessageId,
      userId: ctx.userId,
      agentId: String(ctx.metadata?.agentId ?? '').trim(),
      conversationId: ctx.conversationId,
      objectIds: Array.isArray(args.objectIds)
        ? args.objectIds.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [],
      instruction: String(args.instruction ?? '').trim(),
      model,
      signal,
    });
  }
}
