import { Injectable } from '@nestjs/common';
import type { Prisma, RuntimeObject } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type {
  ObjectPartition,
  ObjectSearchInput,
  ObjectSearchResult,
  RuntimeObjectCreateInput,
} from './object.types';

@Injectable()
export class RuntimeObjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: RuntimeObjectCreateInput): Promise<RuntimeObject> {
    const data: Prisma.RuntimeObjectUncheckedCreateInput = {
      id: input.id,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      originalName: input.originalName,
      displayName: input.displayName,
      baseName: input.baseName,
      extension: input.extension,
      mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      contentHash: input.contentHash,
      duplicateGroupKey: input.duplicateGroupKey,
      versionNo: input.versionNo,
      storageKey: input.storageKey,
      objectKind: input.objectKind,
      originType: input.originType,
      visibility: input.visibility,
      status: input.status,
      metadata: input.metadata ?? {},
    };

    return this.prisma.runtimeObject.create({ data });
  }

  findVersionCandidates(input: {
    userId: string;
    extension: string;
  }): Promise<Array<Pick<RuntimeObject, 'baseName' | 'extension' | 'versionNo'>>> {
    return this.prisma.runtimeObject.findMany({
      where: {
        userId: input.userId,
        extension: input.extension,
      },
      select: {
        baseName: true,
        extension: true,
        versionNo: true,
      },
      orderBy: { versionNo: 'asc' },
    });
  }

  findPartitionedById(partition: ObjectPartition, objectId: string): Promise<RuntimeObject | null> {
    return this.prisma.runtimeObject.findFirst({
      where: {
        id: objectId,
        userId: partition.userId,
        agentId: partition.agentId,
        conversationId: partition.conversationId,
        status: 'available',
        deletedAt: null,
      },
    });
  }

  findPartitionedByIds(partition: ObjectPartition, objectIds: string[]): Promise<RuntimeObject[]> {
    if (objectIds.length === 0) return Promise.resolve([]);
    return this.prisma.runtimeObject.findMany({
      where: {
        id: { in: objectIds },
        userId: partition.userId,
        agentId: partition.agentId,
        conversationId: partition.conversationId,
        status: 'available',
        deletedAt: null,
      },
    });
  }

  async search(input: ObjectSearchInput): Promise<ObjectSearchResult> {
    const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 50));
    const query = String(input.query ?? '').trim();
    const extension = String(input.extension ?? '').trim().replace(/^\./, '').toLowerCase();

    const where: Prisma.RuntimeObjectWhereInput = {
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      visibility: 'user_visible',
      status: 'available',
      deletedAt: null,
      ...(Array.isArray(input.objectIds) ? { id: { in: input.objectIds } } : {}),
      ...(input.objectKind ? { objectKind: input.objectKind } : {}),
      ...(input.originType ? { originType: input.originType } : {}),
      ...(extension ? { extension } : {}),
      ...(query
        ? {
            OR: [
              { originalName: { contains: query, mode: 'insensitive' } },
              { displayName: { contains: query, mode: 'insensitive' } },
              { baseName: { contains: query, mode: 'insensitive' } },
              { metadata: { path: ['contentSummary'], string_contains: query, mode: 'insensitive' } },
              { metadata: { path: ['generation', 'prompt'], string_contains: query, mode: 'insensitive' } },
              { metadata: { path: ['generation', 'revisedPrompt'], string_contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.runtimeObject.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const objects = hasMore ? rows.slice(0, limit) : rows;
    return {
      objects,
      nextCursor: hasMore ? objects[objects.length - 1]?.id ?? null : null,
    };
  }
  findOwnedById(userId: string, objectId: string): Promise<RuntimeObject | null> {
    return this.prisma.runtimeObject.findFirst({
      where: {
        id: objectId,
        userId,
        status: 'available',
        deletedAt: null,
      },
    });
  }

  updateStatusAndMetadata(input: {
    objectId: string;
    status: 'available' | 'failed';
    metadata: Prisma.InputJsonValue;
  }): Promise<RuntimeObject> {
    return this.prisma.runtimeObject.update({
      where: { id: input.objectId },
      data: {
        status: input.status,
        metadata: input.metadata,
      },
    });
  }

  async deleteById(objectId: string): Promise<void> {
    await this.prisma.runtimeObject.deleteMany({ where: { id: objectId } });
  }

}
