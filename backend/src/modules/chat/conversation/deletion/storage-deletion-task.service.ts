import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

import { PrismaService } from '../../../../../prisma/prisma.service';
import { RuntimeObjectStorageService } from '../../../object-runtime/object/object-storage.service';

type DbClient = Prisma.TransactionClient;

type StorageDeletionKind =
  | 'runtime_object'
  | 'project_storage'
  | 'presentation_storage';

interface StorageDeletionTaskInput {
  storageKind: StorageDeletionKind;
  storageKey: string;
  sourceType: string;
  sourceId: string;
}

@Injectable()
export class StorageDeletionTaskService {
  private readonly logger = new Logger(
    StorageDeletionTaskService.name,
  );

  private readonly projectStorageRoot = path.resolve(
    process.cwd(),
    'storage',
  );

  private readonly presentationStorageRoot = path.resolve(
    String(process.env.PRESENTATION_STORAGE_ROOT ?? '').trim()
      || path.join(process.cwd(), 'storage', 'presentations'),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: RuntimeObjectStorageService,
  ) {}

  async enqueueInTransaction(
    tx: DbClient,
    tasks: StorageDeletionTaskInput[],
  ): Promise<void> {
    const rows = this.normalizeTasks(tasks);
    if (rows.length === 0) return;

    await tx.storageDeletionTask.createMany({
      data: rows.map((task) => ({
        deduplicationKey: this.deduplicationKey(
          task.storageKind,
          task.storageKey,
        ),
        storageKind: task.storageKind,
        storageKey: task.storageKey,
        sourceType: task.sourceType,
        sourceId: task.sourceId,
        status: 'pending',
        availableAt: new Date(),
      })),
      skipDuplicates: true,
    });
  }

  async processSource(
    sourceType: string,
    sourceId: string,
  ): Promise<void> {
    const tasks = await this.prisma.storageDeletionTask.findMany({
      where: {
        sourceType,
        sourceId,
        OR: [
          {
            status: 'pending',
            availableAt: { lte: new Date() },
          },
          {
            status: 'processing',
            claimedAt: {
              lte: new Date(Date.now() - 10 * 60_000),
            },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    for (const task of tasks) {
      await this.processTask(task.id);
    }
  }

  @Cron('*/10 * * * *')
  async retryPending(): Promise<void> {
    const tasks = await this.prisma.storageDeletionTask.findMany({
      where: {
        OR: [
          {
            status: 'pending',
            availableAt: { lte: new Date() },
          },
          {
            status: 'processing',
            claimedAt: {
              lte: new Date(Date.now() - 10 * 60_000),
            },
          },
        ],
      },
      select: { id: true },
      orderBy: { availableAt: 'asc' },
      take: 100,
    });

    for (const task of tasks) {
      await this.processTask(task.id);
    }
  }

  private async processTask(taskId: string): Promise<void> {
    const now = new Date();
    const claimed = await this.prisma.storageDeletionTask.updateMany({
      where: {
        id: taskId,
        OR: [
          {
            status: 'pending',
            availableAt: { lte: now },
          },
          {
            status: 'processing',
            claimedAt: {
              lte: new Date(now.getTime() - 10 * 60_000),
            },
          },
        ],
      },
      data: {
        status: 'processing',
        claimedAt: now,
      },
    });

    if (claimed.count !== 1) return;

    const task = await this.prisma.storageDeletionTask.findUnique({
      where: { id: taskId },
    });
    if (!task) return;

    try {
      await this.remove(
        task.storageKind as StorageDeletionKind,
        task.storageKey,
      );
      await this.prisma.storageDeletionTask.delete({
        where: { id: task.id },
      });
    } catch (error) {
      const attempts = task.attempts + 1;
      const delayMs = Math.min(
        60 * 60_000,
        30_000 * 2 ** Math.min(attempts - 1, 7),
      );
      const lastError = error instanceof Error
        ? error.message
        : String(error);

      await this.prisma.storageDeletionTask.update({
        where: { id: task.id },
        data: {
          status: 'pending',
          attempts,
          availableAt: new Date(Date.now() + delayMs),
          claimedAt: null,
          lastError: lastError.slice(0, 2000),
        },
      });

      this.logger.error(
        `Storage deletion failed task=${task.id} kind=${task.storageKind} attempts=${attempts}`,
        error instanceof Error ? error.stack : lastError,
      );
    }
  }

  private async remove(
    storageKind: StorageDeletionKind,
    storageKey: string,
  ): Promise<void> {
    if (storageKind === 'runtime_object') {
      await this.objectStorage.remove(storageKey);
      return;
    }

    if (storageKind === 'presentation_storage') {
      const target = path.resolve(
        this.presentationStorageRoot,
        String(storageKey ?? ''),
      );
      if (
        target === this.presentationStorageRoot
        || !target.startsWith(
          `${this.presentationStorageRoot}${path.sep}`,
        )
      ) {
        this.logger.warn(
          `Skipped presentation storage deletion outside root: ${storageKey}`,
        );
        return;
      }
      await fs.rm(target, { recursive: true, force: true });
      return;
    }

    const target = path.resolve(
      process.cwd(),
      String(storageKey ?? ''),
    );

    if (
      target === this.projectStorageRoot
      || !target.startsWith(
        `${this.projectStorageRoot}${path.sep}`,
      )
    ) {
      this.logger.warn(
        `Skipped project storage deletion outside root: ${storageKey}`,
      );
      return;
    }

    await fs.rm(target, {
      recursive: true,
      force: true,
    });
  }

  private normalizeTasks(
    tasks: StorageDeletionTaskInput[],
  ): StorageDeletionTaskInput[] {
    const output = new Map<string, StorageDeletionTaskInput>();

    for (const task of tasks) {
      const storageKey = String(task.storageKey ?? '').trim();
      const sourceType = String(task.sourceType ?? '').trim();
      const sourceId = String(task.sourceId ?? '').trim();
      if (!storageKey || !sourceType || !sourceId) continue;

      const normalized: StorageDeletionTaskInput = {
        storageKind: task.storageKind,
        storageKey,
        sourceType,
        sourceId,
      };
      output.set(
        `${normalized.storageKind}:${normalized.storageKey}`,
        normalized,
      );
    }

    return [...output.values()];
  }

  private deduplicationKey(
    storageKind: StorageDeletionKind,
    storageKey: string,
  ): string {
    return createHash('sha256')
      .update(`${storageKind}:${storageKey}`)
      .digest('hex');
  }
}
