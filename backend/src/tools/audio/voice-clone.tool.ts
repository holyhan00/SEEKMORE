import { BadRequestException, Injectable } from '@nestjs/common';
import { EffectiveMediaRouteService } from '../../modules/llm-settings/application/effective-media-route.service';
import { AudioGenerationService } from '../../modules/media-ai/audio-generation/audio-generation.service';
import type { Dict, Tool, ToolContext } from '../toolstypes';

@Injectable()
export class VoiceCloneTool implements Tool {
  name = 'voice.clone';
  version = '1.0.0';
  description = 'Clone a voice from an owned Audio RuntimeObject after explicit authorization confirmation.';
  tags = ['audio', 'voice', 'clone'];
  timeoutMs = 300_000;
  providerKind = 'object' as const;
  capabilityKinds = ['voice.clone', 'voice.asset.create'];
  sideEffectClass = 'external_effect' as const;
  idempotency = 'required' as const;
  requiresApproval = true;
  riskLevel = 'high' as const;
  inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['objectId', 'displayName', 'consentConfirmed'],
    properties: {
      objectId: { type: 'string', minLength: 1 },
      displayName: { type: 'string', minLength: 1, maxLength: 120 },
      consentConfirmed: {
        type: 'boolean',
        description: 'Must be true only after the user confirms the voice is theirs or they have authorization.',
      },
      removeBackgroundNoise: { type: 'boolean' },
    },
  };

  constructor(
    private readonly routes: EffectiveMediaRouteService,
    private readonly audio: AudioGenerationService,
  ) {}

  validateArgs(args: Dict): void {
    if (!String(args.objectId ?? '').trim()) throw new BadRequestException('VOICE_SOURCE_OBJECT_REQUIRED');
    if (!String(args.displayName ?? '').trim()) throw new BadRequestException('VOICE_DISPLAY_NAME_REQUIRED');
    if (args.consentConfirmed !== true) throw new BadRequestException('VOICE_CLONE_CONSENT_REQUIRED');
  }

  async canExecute(ctx: ToolContext): Promise<boolean> {
    if (!ctx.userId || !ctx.conversationId || !ctx.metadata?.agentId) return false;
    return (await this.routes.get(ctx.userId)).voiceCloning.status === 'available';
  }

  async execute(args: Dict, ctx: ToolContext, signal?: AbortSignal) {
    const config = await this.routes.resolveAudioExecution(ctx.userId, 'voice_cloning');
    return this.audio.cloneVoice({
      config,
      userId: ctx.userId,
      agentId: String(ctx.metadata?.agentId ?? '').trim(),
      conversationId: ctx.conversationId,
      objectId: String(args.objectId ?? '').trim(),
      displayName: String(args.displayName ?? '').trim(),
      consentConfirmed: args.consentConfirmed === true,
      removeBackgroundNoise: args.removeBackgroundNoise === true,
      signal,
    });
  }
}
