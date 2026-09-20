import { BadRequestException, Injectable } from '@nestjs/common';
import { EffectiveMediaRouteService } from '../../modules/llm-settings/application/effective-media-route.service';
import { AudioGenerationService } from '../../modules/media-ai/audio-generation/audio-generation.service';
import type { Dict, Tool, ToolContext } from '../toolstypes';

@Injectable()
export class MusicGenerateTool implements Tool {
  name = 'music.generate';
  version = '1.0.0';
  description = 'Generate a playable song or instrumental track with the configured effective music route and persist it as an Audio RuntimeObject.';
  tags = ['audio', 'music', 'generation', 'object'];
  timeoutMs = 600_000;
  providerKind = 'object' as const;
  capabilityKinds = ['music.generate', 'object.audio.create'];
  sideEffectClass = 'object_create' as const;
  idempotency = 'required' as const;
  requiresApproval = false;
  inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 1_500 },
      lyrics: { type: ['string', 'null'], maxLength: 2_500 },
      instrumental: { type: 'boolean' },
    },
  };

  constructor(
    private readonly routes: EffectiveMediaRouteService,
    private readonly audio: AudioGenerationService,
  ) {}

  validateArgs(args: Dict): void {
    if (!String(args.prompt ?? '').trim()) throw new BadRequestException('MUSIC_PROMPT_REQUIRED');
  }

  async canExecute(ctx: ToolContext): Promise<boolean> {
    if (!ctx.userId || !ctx.conversationId || !ctx.metadata?.agentId) return false;
    return (await this.routes.get(ctx.userId)).musicGeneration.status === 'available';
  }

  async execute(args: Dict, ctx: ToolContext, signal?: AbortSignal) {
    const config = await this.routes.resolveAudioExecution(ctx.userId, 'music_generation');
    const result = await this.audio.generateMusic({
      config,
      userId: ctx.userId,
      agentId: String(ctx.metadata?.agentId ?? '').trim(),
      conversationId: ctx.conversationId,
      prompt: String(args.prompt ?? '').trim(),
      lyrics: String(args.lyrics ?? '').trim() || null,
      instrumental: args.instrumental === true,
      signal,
    });
    return { objects: result.objects.map((object) => ({ ...object, role: 'assistant_output' })) };
  }
}
