import { BadRequestException, Injectable } from '@nestjs/common';
import { VideoGenerationRouteService } from '../../modules/media-ai/video/video-generation-route.service';
import { VideoGenerationService } from '../../modules/media-ai/video/video-generation.service';
import type {
  VideoAudioPreference,
  VideoReferenceDescriptor,
  VideoReferenceRole,
} from '../../modules/media-ai/video/video-generation.types';
import type { Dict, Tool, ToolContext } from '../toolstypes';

@Injectable()
export class VideoGenerateTool implements Tool {
  name = 'video.generate';
  version = '1.0.0';
  description = 'Generate a video with the configured video generation route from text and optional RuntimeObject media references, then persist the MP4 as a RuntimeObject.';
  tags = ['video', 'generation', 'object'];
  timeoutMs = 1_200_000;
  providerKind = 'object' as const;
  capabilityKinds = ['video.generate', 'object.video.create'];
  sideEffectClass = 'object_create' as const;
  idempotency = 'required' as const;
  requiresApproval = false;
  supportsAbort = true;
  latencyClass = 'long' as const;
  inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 20_000 },
      references: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['objectId', 'role'],
          properties: {
            objectId: { type: 'string', minLength: 1 },
            role: {
              type: 'string',
              enum: ['first_frame', 'last_frame', 'subject', 'style', 'reference', 'reference_video'],
            },
          },
        },
      },
      durationSeconds: { type: ['number', 'null'], minimum: 1, maximum: 30 },
      aspectRatio: {
        type: ['string', 'null'],
        enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16', null],
      },
      resolution: {
        type: ['string', 'null'],
        enum: ['480p', '540p', '720p', '768p', '1080p', '2k', '4k', null],
      },
      audio: {
        type: 'string',
        enum: ['auto', 'required', 'silent'],
        description: 'auto accepts the provider default; required requires generated native audio; silent requires a silent video provider/output.',
      },
    },
  };

  constructor(
    private readonly routes: VideoGenerationRouteService,
    private readonly videos: VideoGenerationService,
  ) {}

  validateArgs(args: Dict): void {
    if (!String(args.prompt ?? '').trim()) {
      throw new BadRequestException('VIDEO_PROMPT_REQUIRED');
    }
  }

  async canExecute(ctx: ToolContext): Promise<boolean> {
    if (!ctx.userId || !ctx.conversationId || !ctx.metadata?.agentId) return false;
    return (await this.routes.availability(ctx.userId)).status === 'available';
  }

  async execute(args: Dict, ctx: ToolContext, signal?: AbortSignal) {
    const agentId = String(ctx.metadata?.agentId ?? '').trim();
    return this.videos.generate({
      userId: ctx.userId,
      agentId,
      conversationId: ctx.conversationId,
      prompt: String(args.prompt ?? '').trim(),
      references: normalizeReferences(args.references),
      durationSeconds: args.durationSeconds == null ? null : Number(args.durationSeconds),
      aspectRatio: String(args.aspectRatio ?? '').trim() || null,
      resolution: String(args.resolution ?? '').trim() || null,
      audio: normalizeAudio(args.audio),
      signal,
    }).then((result) => ({
      objects: result.objects.map((object) => ({
        ...object,
        role: 'assistant_output',
      })),
    }));
  }
}

function normalizeReferences(value: unknown): VideoReferenceDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    const objectId = String(record.objectId ?? '').trim();
    const role = normalizeRole(record.role);
    if (!objectId || !role) throw new BadRequestException('VIDEO_REFERENCE_INVALID');
    return { objectId, role };
  });
}

function normalizeRole(value: unknown): VideoReferenceRole | null {
  const role = String(value ?? '').trim();
  return role === 'first_frame'
    || role === 'last_frame'
    || role === 'subject'
    || role === 'style'
    || role === 'reference'
    || role === 'reference_video'
    ? role
    : null;
}

function normalizeAudio(value: unknown): VideoAudioPreference {
  const normalized = String(value ?? '').trim();
  return normalized === 'required' || normalized === 'silent'
    ? normalized
    : 'auto';
}
