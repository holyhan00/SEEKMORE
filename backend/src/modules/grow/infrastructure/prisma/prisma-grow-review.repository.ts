import { Injectable } from '@nestjs/common';
import {
  GrowReviewStatus as PrismaGrowReviewStatus,
  GrowTriggerType as PrismaGrowTriggerType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';
import type {
  GrowReviewRecord,
  GrowReviewStatus,
  GrowTriggerType,
} from '../../domain/grow.types';
import type {
  CreateGrowReviewInput,
  GrowReviewRepositoryPort,
} from '../../ports/grow-review-repository.port';

@Injectable()
export class PrismaGrowReviewRepository implements GrowReviewRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async existsByEventId(eventId: string): Promise<boolean> {
    return Boolean(await this.prisma.growReview.findUnique({
      where: { eventId },
      select: { id: true },
    }));
  }

  async create(input: CreateGrowReviewInput): Promise<GrowReviewRecord> {
    const row = await this.prisma.growReview.create({
      data: {
        eventId: input.event.eventId,
        triggerTurnId: input.event.turnId,
        triggerTraceId: input.event.traceId,
        userId: input.event.userId,
        agentId: input.event.agentId,
        conversationId: input.event.conversationId,
        triggerType: this.triggerToPrisma(input.triggerType),
        status: PrismaGrowReviewStatus.PENDING,
        evidenceJson: input.evidence as unknown as Prisma.InputJsonValue,
      },
    });
    return this.map(row);
  }

  async get(reviewId: string): Promise<GrowReviewRecord | null> {
    const row = await this.prisma.growReview.findUnique({ where: { id: reviewId } });
    return row ? this.map(row) : null;
  }

  async updateStatus(
    reviewId: string,
    status: GrowReviewStatus,
    patch: Partial<GrowReviewRecord> = {},
  ): Promise<GrowReviewRecord> {
    const row = await this.prisma.growReview.update({
      where: { id: reviewId },
      data: {
        status: this.statusToPrisma(status),
        attemptCount: patch.attemptCount,
        startedAt: patch.startedAt ? new Date(patch.startedAt) : undefined,
        completedAt: patch.completedAt ? new Date(patch.completedAt) : undefined,
        focusResultJson: patch.focusResult
          ? patch.focusResult as unknown as Prisma.InputJsonValue
          : undefined,
        createdDraftIds: patch.createdDraftIds,
        publishedVersionIds: patch.publishedVersionIds,
        rejectedVersionIds: patch.rejectedVersionIds,
        errorJson: patch.error
          ? patch.error as unknown as Prisma.InputJsonValue
          : undefined,
        ...(status !== 'running'
          ? { claimedBy: null, claimExpiresAt: null }
          : {}),
      },
    });
    return this.map(row);
  }

  async save(record: GrowReviewRecord): Promise<void> {
    await this.prisma.growReview.update({
      where: { id: record.id },
      data: {
        status: this.statusToPrisma(record.status),
        evidenceJson: record.evidence as unknown as Prisma.InputJsonValue,
        focusResultJson: record.focusResult
          ? record.focusResult as unknown as Prisma.InputJsonValue
          : Prisma.JsonNull,
        createdDraftIds: record.createdDraftIds,
        publishedVersionIds: record.publishedVersionIds,
        rejectedVersionIds: record.rejectedVersionIds,
        errorJson: record.error
          ? record.error as unknown as Prisma.InputJsonValue
          : Prisma.JsonNull,
        attemptCount: record.attemptCount,
        startedAt: record.startedAt ? new Date(record.startedAt) : null,
        completedAt: record.completedAt ? new Date(record.completedAt) : null,
        claimedBy: null,
        claimExpiresAt: null,
      },
    });
  }

  async listPending(limit: number): Promise<GrowReviewRecord[]> {
    const rows = await this.prisma.growReview.findMany({
      where: {
        status: PrismaGrowReviewStatus.PENDING,
        availableAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, Math.min(limit, 100)),
    });
    return rows.map((row) => this.map(row));
  }

  async claimPending(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<GrowReviewRecord[]> {
    const expiresAt = new Date(Date.now() + Math.max(5_000, input.leaseMs));
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw(Prisma.sql`
        SELECT *
        FROM "grow_review"
        WHERE "available_at" <= NOW()
          AND (
            "status" = 'PENDING'
            OR ("status" = 'RUNNING' AND "claim_expires_at" < NOW())
          )
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.min(input.limit, 50))}
      `) as Array<Record<string, unknown>>;
      if (!rows.length) return [];
      const ids = rows.map((row) => String(row.id));
      await tx.growReview.updateMany({
        where: { id: { in: ids } },
        data: {
          status: PrismaGrowReviewStatus.RUNNING,
          claimedBy: input.workerId,
          claimExpiresAt: expiresAt,
        },
      });
      const claimed = await tx.growReview.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: 'asc' },
      });
      return claimed.map((row) => this.map(row));
    });
  }

  async reschedule(input: {
    reviewId: string;
    availableAt: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    await this.prisma.growReview.update({
      where: { id: input.reviewId },
      data: {
        status: PrismaGrowReviewStatus.PENDING,
        availableAt: new Date(input.availableAt),
        claimedBy: null,
        claimExpiresAt: null,
        completedAt: null,
        errorJson: {
          code: input.errorCode,
          message: input.errorMessage,
        },
      },
    });
  }

  countCreatedSince(userId: string, sinceIso: string): Promise<number> {
    return this.prisma.growReview.count({
      where: { userId, createdAt: { gte: new Date(sinceIso) } },
    });
  }

  private map(row: any): GrowReviewRecord {
    return {
      id: row.id,
      eventId: row.eventId,
      triggerTurnId: row.triggerTurnId,
      triggerTraceId: row.triggerTraceId,
      userId: row.userId,
      agentId: row.agentId,
      conversationId: row.conversationId,
      triggerType: String(row.triggerType).toLowerCase() as GrowTriggerType,
      status: String(row.status).toLowerCase() as GrowReviewStatus,
      evidence: Array.isArray(row.evidenceJson) ? row.evidenceJson : [],
      focusResult: row.focusResultJson ?? undefined,
      createdDraftIds: row.createdDraftIds ?? [],
      publishedVersionIds: row.publishedVersionIds ?? [],
      rejectedVersionIds: row.rejectedVersionIds ?? [],
      error: row.errorJson ?? undefined,
      attemptCount: row.attemptCount,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
    };
  }

  private statusToPrisma(value: GrowReviewStatus): PrismaGrowReviewStatus {
    return PrismaGrowReviewStatus[value.toUpperCase() as keyof typeof PrismaGrowReviewStatus];
  }

  private triggerToPrisma(value: GrowTriggerType): PrismaGrowTriggerType {
    return PrismaGrowTriggerType[value.toUpperCase() as keyof typeof PrismaGrowTriggerType];
  }
}
