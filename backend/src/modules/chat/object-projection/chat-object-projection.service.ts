import { Injectable } from '@nestjs/common';
import { MessageObjectRole, MessageRole } from '@prisma/client';
import { MessageObjectLinkService } from '../../object-runtime/message-object/message-object.service';
import type {
  ChatObjectCardDto,
  MessageObjectLinkWithObject,
} from '../../object-runtime/message-object/message-object.types';

@Injectable()
export class ChatObjectProjectionService {
  constructor(private readonly links: MessageObjectLinkService) {}

  async projectMessages(input: {
    userId: string;
    conversationId: string;
    messageIds: string[];
  }): Promise<Map<string, ChatObjectCardDto[]>> {
    const rows = await this.links.listMessageObjects(input);
    const output = new Map<string, ChatObjectCardDto[]>();
    for (const row of rows) {
      const current = output.get(row.messageId) ?? [];
      current.push(this.toCard(row, input.conversationId));
      output.set(row.messageId, current);
    }
    return output;
  }

  async projectMessage(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<ChatObjectCardDto[]> {
    const projected = await this.projectMessages({
      userId: input.userId,
      conversationId: input.conversationId,
      messageIds: [input.messageId],
    });
    return projected.get(input.messageId) ?? [];
  }

  private toCard(
    row: MessageObjectLinkWithObject,
    conversationId: string,
  ): ChatObjectCardDto {
    const expectedRole =
      row.message.role === MessageRole.USER
        ? MessageObjectRole.USER_INPUT
        : row.message.role === MessageRole.ASSISTANT
          ? MessageObjectRole.ASSISTANT_OUTPUT
          : null;

    if (
      row.message.conversationId !== conversationId
      || expectedRole === null
      || row.role !== expectedRole
    ) {
      throw new Error(
        `MESSAGE_OBJECT_ROLE_MISMATCH:${row.messageId}:${row.role}`,
      );
    }

    const object = row.object;
    const metadata = record(object.metadata);
    const media = record(metadata.media);
    const generation = record(metadata.generation);
    const provenance = record(metadata.provenance);
    const sourceTool = text(generation.sourceTool)
      || text(provenance.sourceTool)
      || text(metadata.toolName);
    const generationBatchId = text(generation.batchId);
    const generationIndex = nonNegativeInteger(generation.index);
    const downloadUrl = `/api/objects/${encodeURIComponent(object.id)}/download?agentId=${encodeURIComponent(object.agentId)}&conversationId=${encodeURIComponent(object.conversationId)}`;
    const previewVersion = encodeURIComponent(String(object.contentHash || object.versionNo));
    const previewUrl = `/api/objects/${encodeURIComponent(object.id)}/preview?v=${previewVersion}`;
    return {
      objectId: object.id,
      role: row.role === MessageObjectRole.USER_INPUT ? 'user_input' : 'assistant_output',
      messageId: row.messageId,
      conversationId,
      displayName: object.displayName,
      originalName: object.originalName || undefined,
      objectKind: object.objectKind,
      originType: object.originType,
      mimeType: object.mimeType,
      extension: object.extension || undefined,
      sizeBytes: Number(object.sizeBytes),
      contentHash: object.contentHash,
      versionNo: object.versionNo,
      downloadUrl,
      previewUrl: object.objectKind === 'image' ? previewUrl : undefined,
      ...(sourceTool ? { sourceTool } : {}),
      ...(generationBatchId ? { generationBatchId } : {}),
      ...(generationIndex !== undefined ? { generationIndex } : {}),
      media: ['image', 'audio', 'video'].includes(object.objectKind)
        ? {
            ...(positiveInteger(media.width) ? { width: positiveInteger(media.width) } : {}),
            ...(positiveInteger(media.height) ? { height: positiveInteger(media.height) } : {}),
            ...(text(media.format) ? { format: text(media.format)! } : {}),
            ...(typeof media.hasAlpha === 'boolean' ? { hasAlpha: media.hasAlpha } : {}),
            ...(positiveNumber(media.durationMs) ? { durationMs: positiveNumber(media.durationMs) } : {}),
            ...(positiveInteger(media.sampleRate) ? { sampleRate: positiveInteger(media.sampleRate) } : {}),
            ...(positiveInteger(media.channels) ? { channels: positiveInteger(media.channels) } : {}),
            ...(positiveNumber(media.bitrate) ? { bitrate: positiveNumber(media.bitrate) } : {}),
            ...(text(media.codec) ? { codec: text(media.codec)! } : {}),
          }
        : undefined,
      position: row.position,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null { const output = String(value ?? '').trim(); return output || null; }
function positiveInteger(value: unknown): number | undefined { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : undefined; }
function positiveNumber(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; }

function nonNegativeInteger(value: unknown): number | undefined { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : undefined; }
