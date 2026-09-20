import { Injectable } from '@nestjs/common';
import type { RuntimeObject } from '@prisma/client';
import { RuntimeObjectCapabilityPolicyService } from '../object-processing/runtime-object-capability-policy.service';
import type { ObjectCatalogCard } from './object.types';

@Injectable()
export class ObjectCardMapper {
  constructor(private readonly capabilityPolicy: RuntimeObjectCapabilityPolicyService) {}

  toDto(object: RuntimeObject): ObjectCatalogCard {
    const metadata = record(object.metadata);
    const processing = record(metadata.processing);
    const media = record(metadata.media);
    const generation = record(metadata.generation);
    const provenance = record(metadata.provenance);
    const sourceTool = text(generation.sourceTool)
      ?? text(provenance.sourceTool)
      ?? text(metadata.toolName);
    const generationBatchId = text(generation.batchId);
    const generationIndex = nonNegativeInteger(generation.index);
    const contentSummary = text(metadata.contentSummary);
    const generationIntent = truncate(
      text(generation.revisedPrompt) ?? text(generation.prompt),
      500,
    );
    const capabilities = Array.isArray(metadata.capabilities)
      ? metadata.capabilities.map(String).filter(Boolean)
      : [];
    const downloadUrl = this.downloadUrl(object);
    const previewUrl = object.objectKind === 'image'
      ? this.previewUrl(object)
      : object.objectKind === 'audio'
        ? downloadUrl
        : null;

    return {
      objectId: object.id,
      agentId: object.agentId,
      conversationId: object.conversationId,
      originalName: object.originalName,
      displayName: object.displayName,
      objectKind: object.objectKind,
      originType: object.originType,
      visibility: object.visibility,
      extension: object.extension,
      mimeType: object.mimeType,
      sizeBytes: Number(object.sizeBytes),
      contentHash: object.contentHash,
      versionNo: object.versionNo,
      status: object.status,
      downloadUrl,
      previewUrl,
      ...(sourceTool ? { sourceTool } : {}),
      ...(generationBatchId ? { generationBatchId } : {}),
      ...(generationIndex !== undefined ? { generationIndex } : {}),
      createdAt: object.createdAt.toISOString(),
      updatedAt: object.updatedAt.toISOString(),
      processingStatus: String(processing.status ?? '') === 'ready' ? 'ready' : 'unsupported',
      capabilities,
      contentSummary,
      generationIntent,
      processor: text(processing.processor),
      processorVersion: text(processing.processorVersion),
      media: object.objectKind === 'image' || object.objectKind === 'audio'
        ? {
            ...(positiveInteger(media.width) ? { width: positiveInteger(media.width) } : {}),
            ...(positiveInteger(media.height) ? { height: positiveInteger(media.height) } : {}),
            ...(text(media.format) ? { format: text(media.format)! } : {}),
            ...(typeof media.hasAlpha === 'boolean' ? { hasAlpha: media.hasAlpha } : {}),
            ...(positiveNumber(media.durationMs) ? { durationMs: positiveNumber(media.durationMs) } : {}),
            ...(positiveInteger(media.sampleRate) ? { sampleRate: positiveInteger(media.sampleRate) } : {}),
            ...(positiveInteger(media.channels) ? { channels: positiveInteger(media.channels) } : {}),
            ...(positiveInteger(media.bitrate) ? { bitrate: positiveInteger(media.bitrate) } : {}),
            ...(text(media.codec) ? { codec: text(media.codec)! } : {}),
          }
        : null,
      readyForMessageInput: this.capabilityPolicy.isReadyForMessageInput(object),
    };
  }

  private downloadUrl(object: RuntimeObject): string {
    return `/api/objects/${encodeURIComponent(object.id)}/download`;
  }

  private previewUrl(object: RuntimeObject): string {
    const version = encodeURIComponent(String(object.contentHash || object.versionNo));
    return `/api/objects/${encodeURIComponent(object.id)}/preview?v=${version}`;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  const output = String(value ?? '').trim();
  return output || null;
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function truncate(value: string | null, maximum: number): string | null {
  if (!value) return null;
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}
