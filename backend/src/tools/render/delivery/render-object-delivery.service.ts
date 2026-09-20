import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RuntimeObjectService } from '../../../modules/object-runtime/object/object.service';
import { ObjectCardMapper } from '../../../modules/object-runtime/object/object-card.mapper';
import type { ToolContext } from '../../toolstypes';
import { objectToolPartition } from '../../object/object-tool-context';
import type { RenderArtifact, RenderToolDescriptor } from '../render.types';
import type { RenderDeliveryResult } from './render-delivery.types';

@Injectable()
export class RenderObjectDeliveryService {
  constructor(
    private readonly objects: RuntimeObjectService,
    private readonly cards: ObjectCardMapper,
  ) {}

  async persist(input: {
    artifact: RenderArtifact;
    context: ToolContext;
    filename?: string;
    tool?: RenderToolDescriptor;
    meta?: Record<string, unknown>;
  }): Promise<RenderDeliveryResult> {
    const buffer = input.artifact.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
      throw new BadRequestException({ code: 'RENDER_BINARY_BUFFER_REQUIRED', message: 'Render delivery requires a non-empty binary buffer' });
    }
    const partition = objectToolPartition(input.context);
    const filename = this.normalizeFilename(
      input.filename ?? input.artifact.filename,
      input.artifact.extension,
    );
    const created = await this.objects.createGenerated({
      ...partition,
      originalName: filename,
      mimeType: input.artifact.mimeType,
      buffer,
      preview: input.artifact.preview,
      metadata: {
        ...(input.meta ?? {}),
        source: 'agent_generated',
        role: 'assistant_output',
        assistantMessageId: String(input.context.metadata?.assistantMessageId ?? ''),
        toolName: input.tool?.name ?? null,
      } as Prisma.InputJsonObject,
    });
    const card = this.cards.toDto(created);
    return {
      artifact: {
        ...input.artifact,
        id: created.id,
        artifactId: created.id,
        filename: created.displayName,
        originalName: created.originalName,
        relativePath: '',
        absolutePath: '',
        path: card.downloadUrl,
        sizeBytes: Number(created.sizeBytes),
        status: 'ready',
        buffer: undefined,
        preview: undefined,
      },
      files: [],
      objects: [{ ...card, role: 'assistant_output' }],
      tool: input.tool,
      meta: {
        ...(input.meta ?? {}),
        persisted: true,
        outputTarget: 'object',
        objectId: created.id,
        sizeBytes: Number(created.sizeBytes),
      },
    };
  }

  private normalizeFilename(value: string, extension: string): string {
    const clean = String(value || `artifact.${extension}`)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    const normalized = clean || `artifact.${extension}`;
    return normalized.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
      ? normalized
      : `${normalized}.${extension}`;
  }
}
