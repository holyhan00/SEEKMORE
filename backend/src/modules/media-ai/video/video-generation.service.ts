import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RuntimeObjectService } from '../../object-runtime/object/object.service';
import type { ObjectCatalogCard } from '../../object-runtime/object/object.types';
import { VideoGenerationRouteService } from './video-generation-route.service';
import type {
  VideoGenerateInput,
  VideoProviderRequest,
} from './video-generation.types';
import { VideoProviderRegistry } from './video-provider.registry';
import { VideoReferencePreparationService } from './video-reference-preparation.service';
import { assertMp4 } from './providers/video-provider.util';

@Injectable()
export class VideoGenerationService {
  constructor(
    private readonly objects: RuntimeObjectService,
    private readonly routes: VideoGenerationRouteService,
    private readonly providers: VideoProviderRegistry,
    private readonly references: VideoReferencePreparationService,
  ) {}

  async generate(input: VideoGenerateInput): Promise<{ objects: ObjectCatalogCard[] }> {
    const prompt = String(input.prompt ?? '').trim();
    if (!prompt) throw new BadRequestException('VIDEO_PROMPT_REQUIRED');

    const references = await this.references.prepare({
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      references: input.references,
    });
    const savedSelection = await this.routes.selection(input.userId);
    if (!savedSelection) {
      throw new BadRequestException('VIDEO_GENERATION_MODEL_NOT_CONFIGURED');
    }

    const request: VideoProviderRequest = {
      prompt,
      references,
      durationSeconds: finitePositiveNumber(input.durationSeconds),
      aspectRatio: String(input.aspectRatio ?? '').trim() || null,
      resolution: String(input.resolution ?? '').trim() || null,
      audio: input.audio ?? 'auto',
      model: savedSelection.modelKey,
      signal: input.signal,
    };
    const credentials = await this.routes.credentials(
      input.userId,
      savedSelection.providerKey,
    );
    const resolved = this.providers.resolve({
      credentials,
      request,
      requestedProviderKey: savedSelection.providerKey,
    });
    const output = await resolved.adapter.generate({
      ...request,
      credential: resolved.credential,
    });
    assertMp4(output.buffer);

    const now = Date.now();
    const object = await this.objects.createGenerated({
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      originalName: `generated-video-${now}.mp4`,
      mimeType: 'video/mp4',
      buffer: output.buffer,
      metadata: {
        origin: {
          type: references.length > 0 ? 'generated_from_reference' : 'generated',
          sourceObjectIds: references.map((item) => item.objectId),
        },
        generation: {
          sourceTool: 'video.generate',
          provider: output.providerKey,
          model: output.model,
          prompt,
          durationSeconds: request.durationSeconds ?? null,
          aspectRatio: request.aspectRatio ?? null,
          resolution: request.resolution ?? null,
          audio: request.audio,
          references: references.map((item) => ({
            objectId: item.objectId,
            role: item.role,
          })),
        },
        providerMedia: toInputJsonObject(output.metadata),
        media: {
          format: 'mp4',
          mimeType: 'video/mp4',
        },
      },
    });

    return {
      objects: [await this.objects.inspectCard({
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
      }, object.id)],
    };
  }
}

function finitePositiveNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException('VIDEO_DURATION_INVALID');
  }
  return parsed;
}


function toInputJsonObject(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonObject {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}
