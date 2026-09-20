import { Injectable } from '@nestjs/common';
import type { MemoryWriteFrame } from '../frames/memory-frame.types';
import type { MemoryCandidate, MemoryFactRecord, MemoryNamespace } from '../kernel/memory.types';
import {
  isDurableMemoryCandidate,
  memoryKindGroup,
  memoryLexicalTokens,
  memoryTokenJaccard,
  normalizeMemoryText,
} from '../shared/memory-primitives';

export type ImplicitMemoryDecisionAction =
  | 'episode_only'
  | 'skip'
  | 'pending'
  | 'active'
  | 'defer';

export type ImplicitMemoryDecisionReason =
  | 'explicit_memory_bypassed'
  | 'implicit_ephemeral'
  | 'implicit_low_confidence'
  | 'implicit_structurally_weak'
  | 'implicit_event_only'
  | 'implicit_sensitive_pending'
  | 'implicit_restricted_skip'
  | 'implicit_deleted_guard'
  | 'implicit_existing_active'
  | 'implicit_repeated_candidate'
  | 'implicit_first_occurrence_pending'
  | 'implicit_deferred';

export type ImplicitMemoryDecision = {
  action: ImplicitMemoryDecisionAction;
  reason: ImplicitMemoryDecisionReason;
  candidate?: MemoryCandidate;
  confidence: number;
  targetMemoryId?: string | null;
};

@Injectable()
export class ImplicitMemoryPolicy {
  decide(input: {
    frame: MemoryWriteFrame;
    namespace: MemoryNamespace;
    candidate: MemoryCandidate;
    similarActive: MemoryFactRecord[];
    similarPending: MemoryFactRecord[];
    similarDeleted?: MemoryFactRecord[];
  }): ImplicitMemoryDecision {
    const candidate = input.candidate;

    if (input.frame.explicitness === 'explicit') {
      return this.active('explicit_memory_bypassed', candidate);
    }

    if (!candidate.evidence?.source) {
      return this.episodeOnly('implicit_structurally_weak', candidate);
    }

    if (candidate.sensitivity === 'restricted') {
      return this.skip('implicit_restricted_skip', candidate);
    }

    if (candidate.sensitivity === 'sensitive') {
      return this.pending('implicit_sensitive_pending', candidate);
    }

    if (this.isDeletedGuardHit(input.similarDeleted ?? [], candidate)) {
      return this.defer('implicit_deleted_guard', candidate);
    }

    if (candidate.stability === 'ephemeral') {
      return this.episodeOnly('implicit_ephemeral', candidate);
    }

    if (candidate.kind === 'event' || candidate.kind === 'episode') {
      return this.episodeOnly('implicit_event_only', candidate);
    }

    if (this.isStructurallyWeak(candidate)) {
      return this.episodeOnly('implicit_structurally_weak', candidate);
    }

    if (candidate.confidence < this.minimumCandidateConfidence(candidate)) {
      return this.episodeOnly('implicit_low_confidence', candidate);
    }

    if (this.hasStrongActiveMatch(input.similarActive, candidate)) {
      return this.skip('implicit_existing_active', candidate);
    }

    if (
      input.similarPending.length > 0 &&
      isDurableMemoryCandidate(candidate) &&
      candidate.sensitivity === 'normal' &&
      candidate.stability === 'long_term' &&
      candidate.confidence >= 0.75
    ) {
      return this.active('implicit_repeated_candidate', candidate);
    }

    if (isDurableMemoryCandidate(candidate)) {
      return this.pending('implicit_first_occurrence_pending', candidate);
    }

    return this.defer('implicit_deferred', candidate);
  }

  private episodeOnly(
    reason: ImplicitMemoryDecisionReason,
    candidate: MemoryCandidate,
  ): ImplicitMemoryDecision {
    return { action: 'episode_only', reason, candidate, confidence: candidate.confidence };
  }

  private skip(
    reason: ImplicitMemoryDecisionReason,
    candidate: MemoryCandidate,
  ): ImplicitMemoryDecision {
    return { action: 'skip', reason, candidate, confidence: candidate.confidence };
  }

  private pending(
    reason: ImplicitMemoryDecisionReason,
    candidate: MemoryCandidate,
  ): ImplicitMemoryDecision {
    return { action: 'pending', reason, candidate, confidence: candidate.confidence };
  }

  private active(
    reason: ImplicitMemoryDecisionReason,
    candidate: MemoryCandidate,
  ): ImplicitMemoryDecision {
    return { action: 'active', reason, candidate, confidence: candidate.confidence };
  }

  private defer(
    reason: ImplicitMemoryDecisionReason,
    candidate: MemoryCandidate,
  ): ImplicitMemoryDecision {
    return { action: 'defer', reason, candidate, confidence: candidate.confidence };
  }

  private minimumCandidateConfidence(candidate: MemoryCandidate): number {
    if (candidate.stability === 'long_term') return 0.68;
    if (candidate.stability === 'session') return 0.8;
    return 0.92;
  }

  private isStructurallyWeak(candidate: MemoryCandidate): boolean {
    const subject = normalizeMemoryText(candidate.subject);
    const predicate = normalizeMemoryText(candidate.predicate);
    const summary = normalizeMemoryText(candidate.summary);
    const value = normalizeMemoryText(this.valueText(candidate.value));

    if (!subject || !predicate || !summary) return true;

    return subject.length + predicate.length + summary.length + value.length < 12;
  }

  private hasStrongActiveMatch(existing: MemoryFactRecord[], candidate: MemoryCandidate): boolean {
    return existing.some((fact) => this.matchScore(fact, candidate) >= 0.62);
  }

  private isDeletedGuardHit(deleted: MemoryFactRecord[], candidate: MemoryCandidate): boolean {
    return deleted.some((fact) => this.matchScore(fact, candidate) >= 0.52);
  }

  private matchScore(fact: MemoryFactRecord, candidate: MemoryCandidate): number {
    if (fact.scopeLevel !== candidate.scopeLevel) return 0;
    if (memoryKindGroup(fact.kind) !== memoryKindGroup(candidate.kind)) return 0;

    const subjectScore = this.textSimilarity(fact.subject, candidate.subject);
    const predicateScore = this.textSimilarity(fact.predicate, candidate.predicate);
    const summaryScore = this.textSimilarity(fact.summary, candidate.summary);
    const valueScore = this.textSimilarity(fact.valueJson, candidate.value);
    const fullScore = this.textSimilarity(this.factText(fact), this.candidateText(candidate));

    return (
      subjectScore * 0.2 +
      predicateScore * 0.16 +
      summaryScore * 0.22 +
      valueScore * 0.2 +
      fullScore * 0.22
    );
  }

  private factText(fact: MemoryFactRecord): string {
    return [
      fact.scopeLevel,
      fact.kind,
      fact.subject,
      fact.predicate,
      fact.summary,
      this.valueText(fact.valueJson),
    ].join(' ');
  }

  private candidateText(candidate: MemoryCandidate): string {
    return [
      candidate.scopeLevel,
      candidate.kind,
      candidate.subject,
      candidate.predicate,
      candidate.summary,
      this.valueText(candidate.value),
      ...(candidate.tags ?? []),
    ].join(' ');
  }

  private valueText(value: unknown): string {
    if (typeof value === 'string') return value;
    return JSON.stringify(value ?? '');
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