import type {
  GrowReviewRecord,
  GrowReviewStatus,
  GrowTerminalEvent,
  GrowTriggerType,
  GrowTurnEvidence,
} from '../domain/grow.types';

export interface CreateGrowReviewInput {
  event: GrowTerminalEvent;
  triggerType: GrowTriggerType;
  evidence: GrowTurnEvidence[];
}

export interface GrowReviewRepositoryPort {
  existsByEventId(eventId: string): Promise<boolean>;
  create(input: CreateGrowReviewInput): Promise<GrowReviewRecord>;
  get(reviewId: string): Promise<GrowReviewRecord | null>;
  updateStatus(
    reviewId: string,
    status: GrowReviewStatus,
    patch?: Partial<GrowReviewRecord>,
  ): Promise<GrowReviewRecord>;
  save(record: GrowReviewRecord): Promise<void>;
  listPending(limit: number): Promise<GrowReviewRecord[]>;
  claimPending(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<GrowReviewRecord[]>;
  reschedule(input: {
    reviewId: string;
    availableAt: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  countCreatedSince(userId: string, sinceIso: string): Promise<number>;
}
