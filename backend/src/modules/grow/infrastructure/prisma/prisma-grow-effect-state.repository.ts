import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import type { GrowEffectObservation } from '../../domain/grow.types';
import type { GrowEffectStatePort } from '../../ports/grow-effect-state.port';

@Injectable()
export class PrismaGrowEffectStateRepository implements GrowEffectStatePort {
  constructor(private readonly prisma: PrismaService) {}

  async register(observation: GrowEffectObservation): Promise<void> {
    await this.prisma.growEffectObservation.upsert({
      where: {
        skillId_skillVersionId: {
          skillId: observation.skillId,
          skillVersionId: observation.versionId,
        },
      },
      create: this.data(observation),
      update: {},
    });
  }

  async get(skillId: string, versionId: string): Promise<GrowEffectObservation | null> {
    const row = await this.prisma.growEffectObservation.findUnique({
      where: { skillId_skillVersionId: { skillId, skillVersionId: versionId } },
    });
    return row ? this.map(row) : null;
  }

  async save(observation: GrowEffectObservation): Promise<void> {
    await this.prisma.growEffectObservation.update({
      where: {
        skillId_skillVersionId: {
          skillId: observation.skillId,
          skillVersionId: observation.versionId,
        },
      },
      data: {
        completedCount: observation.completedCount,
        failedCount: observation.failedCount,
        rejectedCount: observation.rejectedCount,
        consecutiveFailures: observation.consecutiveFailures,
        totalObserved: observation.totalObserved,
        rolledBackAt: observation.rolledBackAt
          ? new Date(observation.rolledBackAt)
          : null,
        closedAt: observation.closedAt ? new Date(observation.closedAt) : null,
      },
    });
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    return Boolean(await this.prisma.growEffectEventReceipt.findUnique({
      where: { eventId },
      select: { id: true },
    }));
  }

  async markProcessedEvent(eventId: string): Promise<void> {
    await this.prisma.growEffectEventReceipt.upsert({
      where: { eventId },
      create: { eventId },
      update: {},
    });
  }

  private data(value: GrowEffectObservation) {
    return {
      skillId: value.skillId,
      skillVersionId: value.versionId,
      previousVersionId: value.previousVersionId ?? null,
      reviewId: value.reviewId,
      userId: value.userId,
      publishedAt: new Date(value.publishedAt),
      completedCount: value.completedCount,
      failedCount: value.failedCount,
      rejectedCount: value.rejectedCount,
      consecutiveFailures: value.consecutiveFailures,
      totalObserved: value.totalObserved,
      rolledBackAt: value.rolledBackAt ? new Date(value.rolledBackAt) : null,
      closedAt: value.closedAt ? new Date(value.closedAt) : null,
    };
  }

  private map(row: any): GrowEffectObservation {
    return {
      skillId: row.skillId,
      versionId: row.skillVersionId,
      previousVersionId: row.previousVersionId ?? undefined,
      reviewId: row.reviewId,
      userId: row.userId,
      publishedAt: row.publishedAt.toISOString(),
      completedCount: row.completedCount,
      failedCount: row.failedCount,
      rejectedCount: row.rejectedCount,
      consecutiveFailures: row.consecutiveFailures,
      totalObserved: row.totalObserved,
      rolledBackAt: row.rolledBackAt?.toISOString(),
      closedAt: row.closedAt?.toISOString(),
    };
  }
}
