                                                                    
import { Injectable } from '@nestjs/common';
import type { MemoryCandidate, MemoryFactRecord } from '../kernel/memory.types';
import {
  isDurableMemoryCandidate,
  memoryKindGroup,
  memoryLexicalTokens,
  memoryTokenJaccard,
  normalizeMemoryText,
} from '../shared/memory-primitives';

export type MemoryPromotionReason =
  | 'repeated_candidate'
  | 'high_confidence_candidate'
  | 'matured_by_age';

export type MemoryPromotionDecision = {
  shouldPromote: boolean;
  reason: MemoryPromotionReason | null;
  confidence: number;
};

@Injectable()
export class MemoryPromotionPolicy {
  decidePendingPromotion(input: {
    pendingFact: MemoryFactRecord;
    incomingCandidate: MemoryCandidate;
    now?: Date;
  }): MemoryPromotionDecision {
    const now = input.now ?? new Date();
    const pending = input.pendingFact;
    const candidate = input.incomingCandidate;

    if (pending.status !== 'pending_confirmation') {
      return this.noop();
    }

    if (!this.sameBaseSlot(pending, candidate)) {
      return this.noop();
    }

    const confidence = Math.max(pending.confidence, candidate.confidence);

    if (
      isDurableMemoryCandidate(candidate) &&
      candidate.sensitivity === 'normal' &&
      candidate.stability === 'long_term' &&
      confidence >= 0.75
    ) {
      return {
        shouldPromote: true,
        reason: 'repeated_candidate',
        confidence,
      };
    }

    const repeatedScore = this.repeatedCandidateScore(pending, candidate);

    if (repeatedScore >= 0.58 && confidence >= 0.72) {
      return {
        shouldPromote: true,
        reason: 'repeated_candidate',
        confidence,
      };
    }

    if (confidence >= 0.94 && repeatedScore >= 0.42) {
      return {
        shouldPromote: true,
        reason: 'high_confidence_candidate',
        confidence,
      };
    }

    const ageDays = this.ageInDays(pending.createdAt, now);
    if (ageDays >= 7 && confidence >= 0.9) {
      return {
        shouldPromote: true,
        reason: 'matured_by_age',
        confidence,
      };
    }

    return this.noop(confidence);
  }

  private noop(confidence = 0): MemoryPromotionDecision {
    return {
      shouldPromote: false,
      reason: null,
      confidence,
    };
  }

  private sameBaseSlot(pending: MemoryFactRecord, candidate: MemoryCandidate): boolean {
    if (pending.scopeLevel !== candidate.scopeLevel) return false;
    return memoryKindGroup(pending.kind) === memoryKindGroup(candidate.kind);
  }

  private repeatedCandidateScore(
    pending: MemoryFactRecord,
    candidate: MemoryCandidate,
  ): number {
    const subjectScore = this.textSimilarity(pending.subject, candidate.subject);
    const predicateScore = this.textSimilarity(pending.predicate, candidate.predicate);
    const valueScore = this.textSimilarity(pending.valueJson, candidate.value);
    const summaryScore = this.textSimilarity(pending.summary, candidate.summary);
    const fullScore = this.textSimilarity(this.factText(pending), this.candidateText(candidate));

    return (
      subjectScore * 0.18 +
      predicateScore * 0.16 +
      valueScore * 0.24 +
      summaryScore * 0.18 +
      fullScore * 0.24
    );
  }

  private ageInDays(createdAt: string | null, now: Date): number {
    if (!createdAt) return 0;

    const created = new Date(createdAt);
    const time = created.getTime();

    if (!Number.isFinite(time)) return 0;

    return Math.max(0, (now.getTime() - time) / 86_400_000);
  }

  private factText(fact: MemoryFactRecord): string {
    return [
      fact.scopeLevel,
      fact.kind,
      fact.subject,
      fact.predicate,
      fact.summary,
      JSON.stringify(fact.valueJson ?? ''),
    ].join(' ');
  }

  private candidateText(candidate: MemoryCandidate): string {
    return [
      candidate.scopeLevel,
      candidate.kind,
      candidate.subject,
      candidate.predicate,
      candidate.summary,
      JSON.stringify(candidate.value ?? ''),
      ...(candidate.tags ?? []),
    ].join(' ');
  }

  private textSimilarity(left: unknown, right: unknown): number {
    return memoryTokenJaccard(this.tokens(left), this.tokens(right));
  }

  private tokens(value: unknown): string[] {
    const text = normalizeMemoryText(
      typeof value === 'string' ? value : JSON.stringify(value ?? ''),
    );
    return memoryLexicalTokens(text);
  }
}