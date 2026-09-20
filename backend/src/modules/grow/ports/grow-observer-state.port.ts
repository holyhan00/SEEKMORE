import type {
  GrowObserverState,
  GrowTurnEvidence,
} from '../domain/grow.types';

export interface GrowObserverStatePort {
  getOrCreate(userId: string, agentId: string): Promise<GrowObserverState>;
  accumulate(
    state: GrowObserverState,
    evidence: GrowTurnEvidence,
  ): Promise<GrowObserverState>;
  markReviewed(
    state: GrowObserverState,
    turnId: string,
    reviewedAt: string,
  ): Promise<GrowObserverState>;
}
