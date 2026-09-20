import type {
  GrowProcessResult,
  GrowTerminalEvent,
} from '../domain/grow.types';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import { GrowObserverService } from './grow-observer.service';
import { GrowReviewProcessorService } from './grow-review-processor.service';

export class GrowOrchestratorService {
  constructor(
    private readonly observer: GrowObserverService,
    private readonly processor: GrowReviewProcessorService,
    private readonly logger: GrowLoggerPort,
  ) {}

  async observeOnly(event: GrowTerminalEvent): Promise<string | null> {
    const review = await this.observer.observe(event);
    return review?.id ?? null;
  }

  async processReview(reviewId: string): Promise<GrowProcessResult> {
    return this.processor.process(reviewId);
  }

  async observeAndProcess(event: GrowTerminalEvent): Promise<GrowProcessResult | null> {
    const review = await this.observer.observe(event);
    if (!review) return null;

    this.logger.log({
      level: 'debug',
      event: 'grow.simulation.inline_processing',
      message:
        'Processing Grow review inline. Production wiring should enqueue this review and process it asynchronously.',
      fields: { reviewId: review.id },
    });
    return this.processor.process(review.id);
  }
}
