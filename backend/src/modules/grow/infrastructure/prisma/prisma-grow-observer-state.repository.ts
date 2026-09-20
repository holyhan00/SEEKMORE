import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import type { GrowObserverState, GrowTurnEvidence } from '../../domain/grow.types';
import type { GrowObserverStatePort } from '../../ports/grow-observer-state.port';

@Injectable()
export class PrismaGrowObserverStateRepository implements GrowObserverStatePort {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string, agentId: string): Promise<GrowObserverState> {
    const row = await this.prisma.growObserverState.upsert({
      where: { userId_agentId: { userId, agentId } },
      create: { userId, agentId },
      update: {},
    });
    return this.map(row);
  }

  async accumulate(
    state: GrowObserverState,
    evidence: GrowTurnEvidence,
  ): Promise<GrowObserverState> {
    const row = await this.prisma.growObserverState.update({
      where: { userId_agentId: { userId: state.userId, agentId: state.agentId } },
      data: {
        toolIterationsSinceReview: {
          increment: Math.max(0, Math.trunc(evidence.toolIterations)),
        },
      },
    });
    return this.map(row);
  }

  async markReviewed(
    state: GrowObserverState,
    turnId: string,
    reviewedAt: string,
  ): Promise<GrowObserverState> {
    const row = await this.prisma.growObserverState.update({
      where: { userId_agentId: { userId: state.userId, agentId: state.agentId } },
      data: {
        toolIterationsSinceReview: 0,
        lastReviewedTurnId: turnId,
        lastReviewAt: new Date(reviewedAt),
      },
    });
    return this.map(row);
  }

  private map(row: {
    userId: string;
    agentId: string;
    toolIterationsSinceReview: number;
    lastReviewAt: Date | null;
    lastReviewedTurnId: string | null;
  }): GrowObserverState {
    return {
      userId: row.userId,
      agentId: row.agentId,
      toolIterationsSinceReview: row.toolIterationsSinceReview,
      lastReviewAt: row.lastReviewAt?.toISOString() ?? null,
      lastReviewedTurnId: row.lastReviewedTurnId,
    };
  }
}
