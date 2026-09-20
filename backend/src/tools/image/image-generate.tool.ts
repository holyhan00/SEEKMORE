import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EffectiveMediaRouteService } from '../../modules/llm-settings/application/effective-media-route.service';
import { ImageGenerationService } from '../../modules/media-ai/image-generation/image-generation.service';
import type { Dict, Tool, ToolContext } from '../toolstypes';

@Injectable()
export class ImageGenerateTool implements Tool {
  name = 'image.generate';
  version = '1.0.0';
  description = 'Generate or edit images with the configured effective image route and persist every output as a RuntimeObject.';
  tags = ['image', 'generation', 'object'];
  timeoutMs = 300_000;
  providerKind = 'object' as const;
  capabilityKinds = ['image.generate', 'image.edit', 'object.image.create'];
  sideEffectClass = 'object_create' as const;
  idempotency = 'required' as const;
  requiresApproval = false;
  inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 20_000 },
      sourceObjectIds: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string', minLength: 1 },
      },
      maskObjectId: { type: ['string', 'null'] },
      count: { type: 'integer', minimum: 1, maximum: 4 },
      aspectRatio: {
        type: ['string', 'null'],
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', 'auto', null],
        description: 'Requested output aspect ratio. Use 16:9 for wide landscape, 9:16 for portrait, and 1:1 for square.',
      },
      outputSize: {
        type: ['string', 'null'],
        enum: ['auto', '1K', '2K', '4K', null],
        description: 'Requested output resolution tier. The runtime maps this provider-neutrally to each configured image model.',
      },
      quality: { type: 'string', enum: ['standard', 'high'] },
      outputFormat: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
    },
  };

  constructor(
    private readonly routes: EffectiveMediaRouteService,
    private readonly images: ImageGenerationService,
  ) {}

  validateArgs(args: Dict): void {
    if (!String(args.prompt ?? '').trim()) throw new BadRequestException('IMAGE_PROMPT_REQUIRED');
  }

  async canExecute(ctx: ToolContext): Promise<boolean> {
    if (!ctx.userId || !ctx.conversationId || !ctx.metadata?.agentId) return false;
    return (await this.routes.get(ctx.userId)).imageGeneration.status === 'available';
  }

  async execute(args: Dict, ctx: ToolContext, signal?: AbortSignal) {
    const agentId = String(ctx.metadata?.agentId ?? '').trim();
    const model = await this.routes.resolveImageGenerationExecution(ctx.userId);
    return this.images.generate({
      model,
      userId: ctx.userId,
      agentId,
      conversationId: ctx.conversationId,
      generationBatchId: String(
        ctx.requestId
        ?? ctx.idempotencyKey
        ?? randomUUID(),
      ).trim(),
      prompt: String(args.prompt ?? '').trim(),
      sourceObjectIds: arrayOfStrings(args.sourceObjectIds),
      maskObjectId: String(args.maskObjectId ?? '').trim() || null,
      count: Number(args.count ?? 1),
      aspectRatio: String(args.aspectRatio ?? '').trim() || null,
      outputSize: normalizeOutputSize(args.outputSize),
      quality: args.quality === 'high' ? 'high' : 'standard',
      outputFormat: args.outputFormat === 'jpeg' || args.outputFormat === 'webp'
        ? args.outputFormat
        : 'png',
      signal,
    }).then((result) => ({
      objects: result.objects.map((object) => ({
        ...object,
        role: 'assistant_output',
      })),
    }));
  }
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeOutputSize(value: unknown): 'auto' | '1K' | '2K' | '4K' {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === '1K' || normalized === '2K' || normalized === '4K') return normalized;
  return 'auto';
}
