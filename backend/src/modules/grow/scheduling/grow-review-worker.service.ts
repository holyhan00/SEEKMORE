import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GrowError } from '../domain/grow.errors';
import { GrowOrchestratorService } from '../core/grow-orchestrator.service';
import type { GrowPolicy } from '../core/grow-policy';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowReviewRepositoryPort } from '../ports/grow-review-repository.port';
import { GROW_LOGGER, GROW_POLICY, GROW_REVIEW_REPOSITORY } from '../nest/grow.tokens';

@Injectable()
export class GrowReviewWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly workerId = `grow-review:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly orchestrator: GrowOrchestratorService,
    @Inject(GROW_REVIEW_REPOSITORY) private readonly reviews: GrowReviewRepositoryPort,
    @Inject(GROW_POLICY) private readonly policy: GrowPolicy,
    @Inject(GROW_LOGGER) private readonly logger: GrowLoggerPort,
  ) {}

  onModuleInit(): void {
    if (!this.policy.enabled) return;
    const intervalMs = Math.max(1_000, Number(process.env.GROW_REVIEW_INTERVAL_MS ?? 2_000));
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.tick();
    this.logger.log({ level: 'info', event: 'grow.review_worker.started', message: 'Grow review worker started.', fields: { workerId: this.workerId, intervalMs } });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running || !this.policy.enabled) return;
    this.running = true;
    try {
      const rows = await this.reviews.claimPending({ workerId: this.workerId, limit: 3, leaseMs: 180_000 });
      for (const review of rows) await this.process(review.id, review.attemptCount);
    } finally {
      this.running = false;
    }
  }

  private async process(reviewId: string, attempts: number): Promise<void> {
    try {
      await this.orchestrator.processReview(reviewId);
    } catch (error) {
      const growError = error instanceof GrowError ? error : new GrowError('GROW_REVIEW_WORKER_FAILED', error instanceof Error ? error.message : String(error), true);
      const nextAttempt = attempts + 1;
      if (!growError.retryable || nextAttempt >= 5) {
        this.logger.log({ level: 'error', event: 'grow.review.dead', message: 'Grow review exhausted retries.', fields: { reviewId, code: growError.code, attempts: nextAttempt } });
        return;
      }
      const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(nextAttempt - 1, 6));
      await this.reviews.reschedule({
        reviewId,
        availableAt: new Date(Date.now() + delayMs).toISOString(),
        errorCode: growError.code,
        errorMessage: growError.message,
      });
      this.logger.log({ level: 'warn', event: 'grow.review.rescheduled', message: 'Grow review was rescheduled after a retryable failure.', fields: { reviewId, code: growError.code, attempts: nextAttempt, delayMs } });
    }
  }
}
