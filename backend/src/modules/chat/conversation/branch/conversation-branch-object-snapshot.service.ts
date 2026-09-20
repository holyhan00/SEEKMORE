import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

@Injectable()
export class ConversationBranchObjectSnapshotService {
  async cloneMessageObjects(input: {
    tx: Prisma.TransactionClient;
    userId: string;
    agentId: string;
    sourceConversationId: string;
    targetConversationId: string;
    sourceToTargetMessageId: Map<string, string>;
  }): Promise<Map<string, string>> {
    const sourceMessageIds = [...input.sourceToTargetMessageId.keys()];
    if (sourceMessageIds.length === 0) return new Map();

    const links = await input.tx.messageObjectLink.findMany({
      where: {
        messageId: { in: sourceMessageIds },
        object: {
          userId: input.userId,
          agentId: input.agentId,
          conversationId: input.sourceConversationId,
          status: 'available',
          deletedAt: null,
        },
      },
      include: { object: true },
      orderBy: [{ messageId: 'asc' }, { role: 'asc' }, { position: 'asc' }],
    });

    const sourceToTargetObjectId = new Map<string, string>();
    for (const link of links) {
      if (sourceToTargetObjectId.has(link.objectId)) continue;
      const source = link.object;
      const targetObjectId = randomUUID();
      sourceToTargetObjectId.set(source.id, targetObjectId);
      await input.tx.runtimeObject.create({
        data: {
          id: targetObjectId,
          userId: source.userId,
          agentId: source.agentId,
          conversationId: input.targetConversationId,
          originalName: source.originalName,
          displayName: source.displayName,
          baseName: source.baseName,
          extension: source.extension,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
          contentHash: source.contentHash,
          duplicateGroupKey: `branch:${input.targetConversationId}:${targetObjectId}`,
          versionNo: source.versionNo,
          storageKey: source.storageKey,
          objectKind: source.objectKind,
          originType: source.originType,
          visibility: source.visibility,
          status: source.status,
          metadata: mergeMetadata(source.metadata, {
            sourceObjectId: source.id,
            sourceConversationId: input.sourceConversationId,
            branchSnapshot: true,
          }) as Prisma.InputJsonObject,
          deletedAt: null,
        },
      });
    }

    if (links.length === 0) return sourceToTargetObjectId;
    await input.tx.messageObjectLink.createMany({
      data: links.map((link) => ({
        messageId: input.sourceToTargetMessageId.get(link.messageId)!,
        objectId: sourceToTargetObjectId.get(link.objectId)!,
        role: link.role,
        position: link.position,
      })),
      skipDuplicates: true,
    });
    return sourceToTargetObjectId;
  }
}

function mergeMetadata(
  source: unknown,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const value = source && typeof source === 'object' && !Array.isArray(source)
    ? JSON.parse(JSON.stringify(source)) as Record<string, unknown>
    : {};
  return { ...value, ...extra };
}
