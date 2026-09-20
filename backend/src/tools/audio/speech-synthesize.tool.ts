import { BadRequestException, Injectable } from '@nestjs/common';
import { EffectiveMediaRouteService } from '../../modules/llm-settings/application/effective-media-route.service';
import { AudioGenerationService } from '../../modules/media-ai/audio-generation/audio-generation.service';
import type { Dict, Tool, ToolContext } from '../toolstypes';

@Injectable()
export class SpeechSynthesizeTool implements Tool {
  name = 'speech.synthesize';
  version = '1.0.0';
  description = 'Generate playable speech with the configured effective speech route and persist it as an Audio RuntimeObject.';
  tags = ['audio', 'speech', 'generation', 'object'];
  timeoutMs = 300_000;
  providerKind = 'object' as const;
  capabilityKinds = ['speech.synthesize', 'object.audio.create'];
  sideEffectClass = 'object_create' as const;
  idempotency = 'required' as const;
  requiresApproval = false;
  inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 5_000 },
      voiceId: { type: ['string', 'null'], maxLength: 256 },
      speed: { type: 'number', minimum: 0.7, maximum: 1.2 },
    },
  };

  constructor(
    private readonly routes: EffectiveMediaRouteService,
    private readonly audio: AudioGenerationService,
  ) {}

  validateArgs(args: Dict): void {
    if (!String(args.text ?? '').trim()) throw new BadRequestException('SPEECH_TEXT_REQUIRED');
  }

  async canExecute(ctx: ToolContext): Promise<boolean> {
    if (!ctx.userId || !ctx.conversationId || !ctx.metadata?.agentId) return false;
    return (await this.routes.get(ctx.userId)).speechGeneration.status === 'available';
  }

  async execute(args: Dict, ctx: ToolContext, signal?: AbortSignal) {
    const config = await this.routes.resolveAudioExecution(ctx.userId, 'speech_generation');
    const result = await this.audio.synthesize({
      config,
      userId: ctx.userId,
      agentId: String(ctx.metadata?.agentId ?? '').trim(),
      conversationId: ctx.conversationId,
      text: String(args.text ?? '').trim(),
      voiceId: String(args.voiceId ?? '').trim() || null,
      speed: Number(args.speed ?? 1),
      signal,
    });
    return { objects: result.objects.map((object) => ({ ...object, role: 'assistant_output' })) };
  }
}
