import { Injectable, NotFoundException } from '@nestjs/common';
import { ObjectProcessingRegistry } from '../object-processing/object-processing.registry';
import { randomUUID } from 'crypto';
import type { Prisma, RuntimeObject } from '@prisma/client';
import { RuntimeObjectAccessPolicyService } from './object-access-policy.service';
import { ObjectCardMapper } from './object-card.mapper';
import { RuntimeObjectKindService } from './object-kind.service';
import { RuntimeObjectRepository } from './object.repository';
import { RuntimeObjectSecurityPolicyService } from './object-security-policy.service';
import { RuntimeObjectStorageService } from './object-storage.service';
import type {
  ObjectCatalogCard,
  ObjectPartition,
  ObjectSearchInput,
  RuntimeGeneratedObjectInput,
  RuntimeObjectUploadInput,
} from './object.types';
import { RuntimeObjectVersionService } from './object-version.service';

@Injectable()
export class RuntimeObjectService {
  constructor(
    private readonly repo: RuntimeObjectRepository,
    private readonly kind: RuntimeObjectKindService,
    private readonly security: RuntimeObjectSecurityPolicyService,
    private readonly storage: RuntimeObjectStorageService,
    private readonly version: RuntimeObjectVersionService,
    private readonly access: RuntimeObjectAccessPolicyService,
    private readonly cards: ObjectCardMapper,
    private readonly processing: ObjectProcessingRegistry,
  ) {}

  async upload(input: RuntimeObjectUploadInput): Promise<RuntimeObject> {
    await this.access.assertPartition(input);

    const initialName = String(input.object.originalname ?? 'file');
    const objectKind = this.kind.detect({
      objectName: initialName,
      mimeType: input.object.mimetype,
      buffer: input.object.buffer,
    });
    const security = this.security.check({
      originalName: initialName,
      mimeType: input.object.mimetype,
      sizeBytes: input.object.size,
      objectKind,
      buffer: input.object.buffer,
    });

    const originalName = security.normalizedName;
    const extension = this.kind.extension(originalName);
    const baseName = this.kind.baseName(originalName);
    const objectId = randomUUID();
    const stored = await this.storage.saveOriginal({
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      objectId,
      originalName,
      buffer: input.object.buffer,
    });

    let created: RuntimeObject | null = null;
    try {
      created = await this.createWithNameRetry({
        partition: input,
        metadata: this.jsonValue({
          ...this.record(input.metadata),
          processing: {
            status: 'processing',
            startedAt: new Date().toISOString(),
          },
          capabilities: [],
        }),
        objectId,
        originalName,
        extension,
        baseName,
        objectKind,
        originType: 'user_upload',
        visibility: 'user_visible',
        mimeType: security.mimeType,
        storageKey: stored.storageKey,
        contentHash: stored.contentHash,
        sizeBytes: stored.sizeBytes,
        status: 'failed',
      });

      const result = await this.processing.process({
        objectKind,
        originalName,
        extension,
        mimeType: security.mimeType,
        buffer: input.object.buffer,
      });
      const metadata = this.jsonValue({
        ...this.record(input.metadata),
        processing: {
          status: 'ready',
          processor: result.processor,
          processorVersion: result.processorVersion,
          completedAt: new Date().toISOString(),
          ...this.record(result.metadata),
        },
        capabilities: result.capabilities,
        contentSummary: result.contentSummary ?? null,
        parsedContent: result.parsedContent ?? null,
        media: result.media ?? null,
        origin: {
          ...this.record(this.record(input.metadata).origin),
          type: 'upload',
        },
      });

      return await this.repo.updateStatusAndMetadata({
        objectId,
        status: 'available',
        metadata,
      });
    } catch (error) {
      if (created) await this.repo.deleteById(objectId).catch(() => undefined);
      await this.storage.remove(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async createGenerated(input: RuntimeGeneratedObjectInput): Promise<RuntimeObject> {
    await this.access.assertPartition(input);
    const normalizedName = this.security.normalizeName(input.originalName);
    const objectKind = this.kind.detect({
      objectName: normalizedName,
      mimeType: input.mimeType,
      buffer: input.buffer,
    });
    const security = this.security.check({
      originalName: normalizedName,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.byteLength,
      objectKind,
      buffer: input.buffer,
    });
    const originalName = security.normalizedName;
    const extension = this.kind.extension(originalName);
    const baseName = this.kind.baseName(originalName);
    const objectId = randomUUID();
    const stored = await this.storage.saveOriginal({
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      objectId,
      originalName,
      buffer: input.buffer,
    });

    try {
      let metadata = this.record(input.metadata);

      if (input.preview?.buffer?.byteLength) {
        const storedPreview = await this.storage.savePreview({
          userId: input.userId,
          agentId: input.agentId,
          conversationId: input.conversationId,
          objectId,
          extension: input.preview.extension,
          buffer: input.preview.buffer,
        });

        metadata = {
          ...metadata,
          preview: {
            schemaVersion: 1,
            kind: String(input.preview.kind ?? '').trim(),
            mimeType: String(input.preview.mimeType ?? '').trim(),
            extension: String(input.preview.extension ?? '').trim().replace(/^\./, ''),
            storageKey: storedPreview.storageKey,
            sizeBytes: storedPreview.sizeBytes,
            contentHash: storedPreview.contentHash,
          },
        };
      }

      if ((objectKind === 'image' || objectKind === 'audio') && this.processing.supports(objectKind)) {
        const result = await this.processing.process({
          objectKind,
          originalName,
          extension,
          mimeType: security.mimeType,
          buffer: input.buffer,
        });
        metadata = {
          ...metadata,
          processing: {
            status: 'ready',
            processor: result.processor,
            processorVersion: result.processorVersion,
            completedAt: new Date().toISOString(),
          },
          capabilities: result.capabilities,
          contentSummary: result.contentSummary ?? null,
          parsedContent: result.parsedContent ?? null,
          media: {
            ...this.record(metadata.media),
            ...this.record(result.media),
          },
          origin: {
            type: 'generated',
            ...this.record(metadata.origin),
          },
        };
      }

      return await this.createWithNameRetry({
        partition: input,
        metadata: this.jsonValue(metadata),
        objectId,
        originalName,
        extension,
        baseName,
        objectKind,
        originType: 'runtime_generated',
        visibility: input.visibility ?? 'user_visible',
        mimeType: security.mimeType,
        storageKey: stored.storageKey,
        contentHash: stored.contentHash,
        sizeBytes: stored.sizeBytes,
        status: 'available',
      });
    } catch (error) {
      await this.storage.remove(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async inspect(partition: ObjectPartition, objectId: string): Promise<RuntimeObject> {
    await this.access.assertPartition(partition);
    const object = await this.repo.findPartitionedById(partition, this.normalizeObjectId(objectId));
    if (!object) throw new NotFoundException('OBJECT_NOT_FOUND');
    return object;
  }

  async inspectOwned(userId: string, objectId: string): Promise<RuntimeObject> {
    const object = await this.repo.findOwnedById(
      String(userId ?? '').trim(),
      this.normalizeObjectId(objectId),
    );
    if (!object) throw new NotFoundException('OBJECT_NOT_FOUND');
    return object;
  }

  async inspectCard(partition: ObjectPartition, objectId: string): Promise<ObjectCatalogCard> {
    return this.cards.toDto(await this.inspect(partition, objectId));
  }

  async inspectCardsByIds(
    partition: ObjectPartition,
    objectIds: string[],
  ): Promise<Map<string, ObjectCatalogCard>> {
    const ids = [...new Set(objectIds.map((value) => String(value ?? '').trim()).filter(Boolean))];
    if (ids.length === 0) return new Map();
    await this.access.assertPartition(partition);
    const rows = await this.repo.findPartitionedByIds(partition, ids);
    return new Map(rows.map((object) => [object.id, this.cards.toDto(object)]));
  }

  async search(input: ObjectSearchInput): Promise<{ objects: ObjectCatalogCard[]; nextCursor: string | null }> {
    await this.access.assertPartition(input);
    if (input.cursor) {
      if (Array.isArray(input.objectIds) && !input.objectIds.includes(input.cursor)) throw new NotFoundException('OBJECT_CURSOR_NOT_FOUND');
      const cursorObject = await this.repo.findPartitionedById(input, input.cursor);
      if (
        !cursorObject
        || cursorObject.visibility !== 'user_visible'
        || (input.originType && cursorObject.originType !== input.originType)
      ) {
        throw new NotFoundException('OBJECT_CURSOR_NOT_FOUND');
      }
    }
    const result = await this.repo.search(input);
    return {
      objects: result.objects.map((object) => this.cards.toDto(object)),
      nextCursor: result.nextCursor,
    };
  }

  async readBuffer(partition: ObjectPartition, objectId: string, maxBytes: number): Promise<{ object: RuntimeObject; buffer: Buffer }> {
    const object = await this.inspect(partition, objectId);
    const buffer = await this.storage.readBuffer(object.storageKey, maxBytes);
    return { object, buffer };
  }

  createReadStream(object: RuntimeObject) {
    return this.storage.createReadStream(object.storageKey);
  }

  async assertStoredSize(object: RuntimeObject): Promise<void> {
    const stored = await this.storage.stat(object.storageKey);
    if (stored.sizeBytes !== Number(object.sizeBytes)) {
      throw new Error('OBJECT_STORAGE_SIZE_MISMATCH');
    }
  }

  private async createWithNameRetry(input: {
    partition: ObjectPartition;
    metadata?: Prisma.InputJsonValue;
    objectId: string;
    originalName: string;
    extension: string;
    baseName: string;
    objectKind: ReturnType<RuntimeObjectKindService['detect']>;
    originType: 'user_upload' | 'runtime_generated';
    visibility: 'user_visible' | 'internal';
    mimeType: string;
    storageKey: string;
    contentHash: string;
    sizeBytes: number;
    status: 'available' | 'failed';
  }): Promise<RuntimeObject> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const version = await this.version.resolve({
        userId: input.partition.userId,
        baseName: input.baseName,
        extension: input.extension,
      });

      try {
        return await this.repo.create({
          id: input.objectId,
          userId: input.partition.userId,
          agentId: input.partition.agentId,
          conversationId: input.partition.conversationId,
          originalName: input.originalName,
          displayName: version.displayName,
          baseName: input.baseName,
          extension: input.extension,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          contentHash: input.contentHash,
          duplicateGroupKey: version.duplicateGroupKey,
          versionNo: version.versionNo,
          storageKey: input.storageKey,
          objectKind: input.objectKind,
          originType: input.originType,
          visibility: input.visibility,
          status: input.status,
          metadata: input.metadata ?? {},
        });
      } catch (error) {
        if (!this.isUniqueConflict(error) || attempt >= 5) throw error;
      }
    }

    throw new Error('OBJECT_NAME_ALLOCATION_FAILED');
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    )) as Prisma.InputJsonValue;
  }

  private normalizeObjectId(value: string): string {
    const objectId = String(value ?? '').trim();
    if (!objectId || objectId.includes('/') || objectId.includes('\\') || objectId.includes('\u0000')) {
      throw new NotFoundException('OBJECT_NOT_FOUND');
    }
    return objectId;
  }

  private isUniqueConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002');
  }
}
