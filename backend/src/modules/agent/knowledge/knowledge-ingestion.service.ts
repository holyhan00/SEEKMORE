                                                                     

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeParseStatus, Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../../../../prisma/prisma.service';
import { appError } from '../../../common/errors/app-error';
import { DocumentParserService } from '../../document-parser/document-parser.service';
import { KnowledgeChunkerService } from './knowledge-chunker.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import type {
  KnowledgeBatchIngestResult,
  KnowledgeIngestResult,
} from './knowledge.types';

@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);
  private readonly agentStorageRoot = path.resolve(
    process.env.AGENT_STORAGE_DIR
      || path.join(process.cwd(), 'storage', 'agents'),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentParser: DocumentParserService,
    private readonly chunker: KnowledgeChunkerService,
    private readonly embedding: KnowledgeEmbeddingService,
  ) {}

  async ingestFile(objectId: string): Promise<KnowledgeIngestResult> {
    const file = await this.prisma.agentKnowledgeObject.findUnique({
      where: { id: objectId },
    });

    if (!file || file.deletedAt) {
      throw new NotFoundException(appError('KNOWLEDGE_FILE_NOT_FOUND'));
    }

    await this.prisma.agentKnowledgeObject.update({
      where: { id: objectId },
      data: {
        parseStatus: KnowledgeParseStatus.PARSING,
        parseError: null,
      },
    });

    try {
      const buffer = await fs.readFile(
        this.resolveKnowledgeStoragePath(file.storageKey),
      );
      const parsed = await this.documentParser.parse({
        buffer,
        objectName: file.originalName,
        mimeType: file.mimeType,
        extension: file.extension,
        source: 'agent_knowledge',
        assetRole: 'content_material',
        parsePurpose: 'knowledge',
      });
      const chunks = this.chunker.chunkParsedDocument(parsed);

      if (!chunks.length) {
        throw new BadRequestException(appError('KNOWLEDGE_FILE_EMPTY'));
      }

      const vectors = await this.embedding.embedMany(
        chunks.map((chunk) => chunk.content),
      );
      const embeddingEnabled = this.embedding.isEnabled();

      if (embeddingEnabled && vectors.some((vector) => !vector)) {
        throw new Error('Knowledge-base embedding generation was incomplete.');
      }

      const embeddedVectors = vectors.filter(
        (vector): vector is number[] => Array.isArray(vector),
      );
      const embeddingDimension = embeddedVectors[0]?.length ?? null;

      if (
        embeddedVectors.some(
          (vector) => vector.length !== embeddingDimension,
        )
      ) {
        throw new Error('Knowledge-base embedding dimensions are inconsistent.');
      }

      const prior = this.asRecord(file.meta);
      const now = new Date().toISOString();

      await this.prisma.$transaction(async (tx) => {
        await tx.agentKnowledgeChunk.deleteMany({
          where: { objectId: file.id },
        });

        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          const vector = vectors[index];
          const created = await tx.agentKnowledgeChunk.create({
            data: {
              objectId: file.id,
              agentId: file.agentId,
              userId: file.userId,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              tokenCount: chunk.tokenCount,
              embeddingModel: vector ? this.embedding.model : null,
              meta: {
                ...chunk.meta,
                objectRole: 'content_material',
                chunkKind: chunk.kind,
                sourceName: file.originalName,
                documentKind: parsed.kind,
                parserMeta: parsed.meta ?? {},
              } as Prisma.InputJsonValue,
            },
          });

          if (vector) {
            await tx.$executeRawUnsafe(
              'UPDATE agent_knowledge_chunk SET embedding = $1::vector WHERE id = $2',
              this.embedding.toVectorLiteral(vector),
              created.id,
            );
          }
        }

        await tx.agentKnowledgeObject.update({
          where: { id: file.id },
          data: {
            parseStatus: KnowledgeParseStatus.READY,
            parseError: null,
            chunkCount: chunks.length,
            embeddingModel: embeddingEnabled ? this.embedding.model : null,
            meta: {
              ...prior,
              objectRole: 'content_material',
              parsedKind: parsed.kind,
              parsedAt: now,
              parserMeta: parsed.meta ?? {},
              searchableChunkCount: chunks.length,
              embeddedChunkCount: embeddedVectors.length,
              embeddingCoverage: embeddingEnabled
                ? embeddedVectors.length / chunks.length
                : 0,
              embeddingDimension,
            } as Prisma.InputJsonValue,
          },
        });
      });

      const result: KnowledgeIngestResult = {
        objectId: file.id,
        chunkCount: chunks.length,
        embeddedChunkCount: embeddedVectors.length,
        embeddingEnabled,
        embeddingModel: embeddingEnabled ? this.embedding.model : null,
        embeddingDimension,
      };

      this.logger.log(
        [
          'Knowledge ingestion completed',
          `objectId=${file.id}`,
          `chunks=${result.chunkCount}`,
          `embedded=${result.embeddedChunkCount}`,
          `model=${result.embeddingModel ?? 'disabled'}`,
        ].join(' '),
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Knowledge ingestion failed: ${objectId} ${message}`);

      await this.prisma.agentKnowledgeObject
        .update({
          where: { id: file.id },
          data: {
            parseStatus: KnowledgeParseStatus.FAILED,
            parseError: message,
          },
        })
        .catch(() => undefined);

      throw error;
    }
  }

  async ingestPendingForAgent(
    agentId: string,
  ): Promise<KnowledgeBatchIngestResult> {
    const objects = await this.prisma.agentKnowledgeObject.findMany({
      where: {
        agentId,
        deletedAt: null,
        parseStatus: KnowledgeParseStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const result: KnowledgeBatchIngestResult = {
      ingested: [],
      failed: [],
    };

    for (const file of objects) {
      try {
        result.ingested.push(await this.ingestFile(file.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push({ objectId: file.id, error: message });
      }
    }

    if (result.failed.length) {
      this.logger.warn(
        `Knowledge batch ingestion completed with failures: agent=${agentId} failed=${result.failed.length} ingested=${result.ingested.length}`,
      );
    }

    return result;
  }

  private resolveKnowledgeStoragePath(storageKey: string): string {
    const normalized = String(storageKey ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const prefix = 'storage/agents/';

    if (!normalized.startsWith(prefix)) {
      throw new Error('KNOWLEDGE_STORAGE_KEY_INVALID');
    }

    const relative = normalized.slice(prefix.length);
    const absolute = path.resolve(this.agentStorageRoot, relative);
    const rootPrefix = `${this.agentStorageRoot}${path.sep}`;

    if (
      absolute !== this.agentStorageRoot
      && !absolute.startsWith(rootPrefix)
    ) {
      throw new Error('KNOWLEDGE_STORAGE_PATH_ESCAPE');
    }

    return absolute;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }
}
