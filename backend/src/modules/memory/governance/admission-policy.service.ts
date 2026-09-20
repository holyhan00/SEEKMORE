                                                                    
import { Injectable } from '@nestjs/common';
import type {
  MemoryAdmissionDecision,
  MemoryCandidate,
  MemoryFactRecord,
} from '../kernel/memory.types';
import type { MemoryWriteFrame } from '../frames/memory-frame.types';
import {
  memoryKindGroup,
  memoryLexicalTokens,
  memoryTokenJaccard,
  normalizeMemoryText,
} from '../shared/memory-primitives';
import { MemoryPrivacyPolicy } from './privacy-policy.service';

type SkipReason = 'missing_evidence' | 'ephemeral_task' | 'low_confidence' | 'privacy_sensitive';

@Injectable()
export class MemoryAdmissionPolicy {
  constructor(private readonly privacy: MemoryPrivacyPolicy) {}

  decide(input: {
    frame: MemoryWriteFrame;
    candidate: MemoryCandidate;
    similar: MemoryFactRecord[];
  }): MemoryAdmissionDecision {
    const candidate = this.privacy.sanitize(input.candidate);

    const privacyDecision = this.privacy.evaluateWrite({
      frame: input.frame,
      candidate,
    });

    if (!privacyDecision.allowed) {
      return {
        action: 'skip',
        reason: 'privacy_sensitive',
        candidate,
        confidence: candidate.confidence,
      };
    }

    if (privacyDecision.requiresConfirmation) {
      return {
        action: 'ask_confirmation',
        reason: 'privacy_sensitive',
        candidate,
        confidence: candidate.confidence,
      };
    }

    if (!candidate.evidence?.source) {
      return this.skip('missing_evidence', candidate);
    }

    if (this.isStructurallyWeak(candidate)) {
      return this.skip('low_confidence', candidate);
    }

    if (candidate.stability === 'ephemeral' && input.frame.explicitness !== 'explicit') {
      return this.skip('ephemeral_task', candidate);
    }

    if (candidate.confidence < this.threshold(input.frame.explicitness)) {
      return this.skip('low_confidence', candidate);
    }

    const rankedSimilar = this.rankSimilar(input.similar, candidate);

    if (input.frame.intent === 'forget') {
      const target = rankedSimilar.find((item) => this.isForgetTarget(item, candidate));

      if (!target) {
        return this.skip('missing_evidence', candidate);
      }

      return {
        action: 'delete',
        reason: 'user_confirmed',
        candidate,
        targetMemoryId: target.id,
        confidence: candidate.confidence,
      };
    }

    const conflictTarget = rankedSimilar.find((item) => this.isConflict(item, candidate, input.frame));
    if (conflictTarget) {
      return {
        action: 'supersede',
        reason: 'conflict_detected',
        candidate,
        targetMemoryId: conflictTarget.id,
        confidence: candidate.confidence,
      };
    }

    const sameSlot = rankedSimilar.find((item) => this.sameMemorySlot(item, candidate));
    if (sameSlot) {
      return {
        action: 'update_existing',
        reason: 'duplicate',
        candidate: this.mergeCandidate(sameSlot, candidate),
        targetMemoryId: sameSlot.id,
        confidence: candidate.confidence,
      };
    }

    const sameTopic = rankedSimilar.find((item) => this.sameTopic(item, candidate));
    if (sameTopic) {
      return {
        action: 'update_existing',
        reason: 'duplicate',
        candidate: this.mergeCandidate(sameTopic, candidate),
        targetMemoryId: sameTopic.id,
        confidence: candidate.confidence,
      };
    }

    const exactDuplicate = rankedSimilar.find((item) => this.sameMeaning(item, candidate));
    if (exactDuplicate) {
      return {
        action: 'update_existing',
        reason: 'duplicate',
        candidate: this.mergeCandidate(exactDuplicate, candidate),
        targetMemoryId: exactDuplicate.id,
        confidence: candidate.confidence,
      };
    }

    return {
      action: 'write',
      reason: this.reasonFor(candidate, input.frame),
      candidate,
      confidence: candidate.confidence,
    };
  }

  private skip(reason: SkipReason, candidate: MemoryCandidate): MemoryAdmissionDecision {
    return {
      action: 'skip',
      reason,
      candidate,
      confidence: candidate.confidence,
    };
  }

  private threshold(explicitness: 'explicit' | 'implicit'): number {
    return explicitness === 'explicit' ? 0.55 : 0.82;
  }

  private isStructurallyWeak(candidate: MemoryCandidate): boolean {
    const subject = normalizeMemoryText(candidate.subject);
    const predicate = normalizeMemoryText(candidate.predicate);
    const summary = normalizeMemoryText(candidate.summary);
    const value = this.valueText(candidate);

    if (!subject || !predicate || !summary) return true;

    const semanticLength = subject.length + predicate.length + summary.length + value.length;
    return semanticLength < 12;
  }

  private rankSimilar(existing: MemoryFactRecord[], candidate: MemoryCandidate): MemoryFactRecord[] {
    return [...existing]
      .filter((item) => item.status === 'active')
      .sort((left, right) => this.score(right, candidate) - this.score(left, candidate));
  }

  private score(existing: MemoryFactRecord, candidate: MemoryCandidate): number {
    if (!this.sameKindFamily(existing.kind, candidate.kind)) return 0;
    if (existing.scopeLevel !== candidate.scopeLevel) return 0;

    const subjectScore = this.textSimilarity(existing.subject, candidate.subject);
    const predicateScore = this.textSimilarity(existing.predicate, candidate.predicate);
    const summaryScore = this.textSimilarity(existing.summary, candidate.summary);
    const valueScore = this.textSimilarity(existing.valueJson, candidate.value);
    const fullScore = this.textSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const anchorScore = this.anchorSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const structuredScore = this.structuredValueSimilarity(existing.valueJson, candidate.value);

    return (
      subjectScore * 0.14 +
      predicateScore * 0.14 +
      summaryScore * 0.16 +
      valueScore * 0.16 +
      fullScore * 0.16 +
      anchorScore * 0.12 +
      structuredScore * 0.12
    );
  }

  private sameMeaning(existing: MemoryFactRecord, candidate: MemoryCandidate): boolean {
    if (!this.sameMemorySlot(existing, candidate)) return false;

    const valueScore = this.textSimilarity(existing.valueJson, candidate.value);
    const summaryScore = this.textSimilarity(existing.summary, candidate.summary);
    const fullScore = this.textSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const anchorScore = this.anchorSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const structuredScore = this.structuredValueSimilarity(existing.valueJson, candidate.value);

    return (
      structuredScore >= 0.5 ||
      valueScore >= 0.72 ||
      summaryScore >= 0.78 ||
      (anchorScore >= 0.5 && fullScore >= 0.18)
    );
  }

  private sameMemorySlot(existing: MemoryFactRecord, candidate: MemoryCandidate): boolean {
    if (!this.sameKindFamily(existing.kind, candidate.kind)) return false;
    if (existing.scopeLevel !== candidate.scopeLevel) return false;

    const subjectScore = this.textSimilarity(existing.subject, candidate.subject);
    const predicateScore = this.textSimilarity(existing.predicate, candidate.predicate);
    const summaryScore = this.textSimilarity(existing.summary, candidate.summary);
    const valueScore = this.textSimilarity(existing.valueJson, candidate.value);
    const fullScore = this.textSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const anchorScore = this.anchorSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const structuredScore = this.structuredValueSimilarity(existing.valueJson, candidate.value);

    return (
      (subjectScore >= 0.58 && predicateScore >= 0.5) ||
      fullScore >= 0.42 ||
      structuredScore >= 0.5 ||
      (anchorScore >= 0.5 && (summaryScore >= 0.16 || valueScore >= 0.16 || fullScore >= 0.16))
    );
  }

  private sameTopic(existing: MemoryFactRecord, candidate: MemoryCandidate): boolean {
    if (!this.sameKindFamily(existing.kind, candidate.kind)) return false;
    if (existing.scopeLevel !== candidate.scopeLevel) return false;

    const fullScore = this.textSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const subjectScore = this.textSimilarity(existing.subject, candidate.subject);
    const summaryScore = this.textSimilarity(existing.summary, candidate.summary);
    const valueScore = this.textSimilarity(existing.valueJson, candidate.value);
    const anchorScore = this.anchorSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const structuredScore = this.structuredValueSimilarity(existing.valueJson, candidate.value);

    return (
      fullScore >= 0.36 ||
      structuredScore >= 0.5 ||
      (subjectScore >= 0.45 && summaryScore >= 0.32) ||
      (anchorScore >= 0.5 && (summaryScore >= 0.14 || valueScore >= 0.14 || fullScore >= 0.14))
    );
  }

  private isConflict(
    existing: MemoryFactRecord,
    candidate: MemoryCandidate,
    frame: MemoryWriteFrame,
  ): boolean {
    if (frame.explicitness !== 'explicit') return false;
    if (!this.sameKindFamily(existing.kind, candidate.kind)) return false;
    if (existing.scopeLevel !== candidate.scopeLevel) return false;

    if (this.hasStructuredConflict(existing.valueJson, candidate.value)) {
      return true;
    }

    if (this.hasValueReplacementConflict(existing, candidate)) {
      return true;
    }

    const sameSlot = this.sameMemorySlot(existing, candidate) || this.sameTopic(existing, candidate);
    if (!sameSlot) return false;

    return this.memoryCompatibility(existing, candidate) < 0.5;
  }

  private isForgetTarget(existing: MemoryFactRecord, candidate: MemoryCandidate): boolean {
    if (this.sameMemorySlot(existing, candidate)) return true;

    const fullScore = this.textSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const anchorScore = this.anchorSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const structuredScore = this.structuredValueSimilarity(existing.valueJson, candidate.value);

    return fullScore >= 0.45 || structuredScore >= 0.5 || anchorScore >= 0.75;
  }

  private mergeCandidate(existing: MemoryFactRecord, candidate: MemoryCandidate): MemoryCandidate {
    const existingSummary = this.normalizeForDisplay(existing.summary);
    const candidateSummary = this.normalizeForDisplay(candidate.summary);

    const summary =
      existingSummary && candidateSummary && !this.containsSentence(existingSummary, candidateSummary)
        ? `${existingSummary} ${candidateSummary}`
        : candidateSummary || existingSummary;

    return {
      ...candidate,
      summary,
      confidence: Math.max(existing.confidence, candidate.confidence),
    };
  }

  private reasonFor(candidate: MemoryCandidate, frame: MemoryWriteFrame) {
    if (frame.explicitness === 'explicit') return 'explicit_memory_request' as const;
    if (candidate.kind === 'project_state') return 'project_state' as const;
    if (candidate.kind === 'constraint') return 'stable_constraint' as const;
    if (candidate.kind === 'preference' || candidate.kind === 'tool_preference') {
      return 'stable_preference' as const;
    }
    if (candidate.kind === 'event' || candidate.kind === 'episode') {
      return 'conversation_event' as const;
    }
    return 'user_confirmed' as const;
  }

  private sameKindFamily(left: MemoryFactRecord['kind'], right: MemoryCandidate['kind']): boolean {
    return memoryKindGroup(left) === memoryKindGroup(right);
  }

  private anchorSimilarity(left: unknown, right: unknown): number {
    const leftAnchors = this.anchorTokens(left);
    const rightAnchors = this.anchorTokens(right);

    if (!leftAnchors.length || !rightAnchors.length) return 0;

    const leftSet = new Set(leftAnchors);
    const rightSet = new Set(rightAnchors);

    let intersection = 0;
    for (const token of leftSet) {
      if (rightSet.has(token)) intersection += 1;
    }

    const smaller = Math.min(leftSet.size, rightSet.size);
    return smaller > 0 ? intersection / smaller : 0;
  }

  private anchorTokens(value: unknown): string[] {
    const text = normalizeMemoryText(typeof value === 'string' ? value : JSON.stringify(value ?? ''));

    if (!text) return [];

    return Array.from(new Set(text.match(/[a-z0-9][a-z0-9_-]{1,}/gi) ?? []));
  }

  private structuredValueSimilarity(left: unknown, right: unknown): number {
    const leftTokens = this.structuredTokens(left);
    const rightTokens = this.structuredTokens(right);

    if (!leftTokens.length || !rightTokens.length) return 0;

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);

    let intersection = 0;
    for (const token of leftSet) {
      if (rightSet.has(token)) intersection += 1;
    }

    const smaller = Math.min(leftSet.size, rightSet.size);
    return smaller > 0 ? intersection / smaller : 0;
  }

  private hasStructuredConflict(left: unknown, right: unknown): boolean {
  const leftScalars = this.scalarMap(left);
  const rightScalars = this.scalarMap(right);

  if (!leftScalars.size || !rightScalars.size) return false;

  let comparable = 0;
  let different = 0;

  for (const [key, leftValue] of leftScalars.entries()) {
    const rightValue = rightScalars.get(key);
    if (!rightValue) continue;

    comparable += 1;
    if (leftValue !== rightValue) different += 1;
  }

  if (comparable > 0) {
    return different > 0;
  }

  const leftValues = this.scalarValues(left);
  const rightValues = this.scalarValues(right);

  if (!leftValues.length || !rightValues.length) return false;

  return !leftValues.some((value) => rightValues.includes(value));
}

  private hasValueReplacementConflict(
    existing: MemoryFactRecord,
    candidate: MemoryCandidate,
  ): boolean {
    const existingValues = this.scalarValues(existing.valueJson);
    const candidateValues = this.scalarValues(candidate.value);

    if (!existingValues.length || !candidateValues.length) return false;

    const existingText = normalizeMemoryText(this.memoryText(existing));
    const candidateText = normalizeMemoryText(this.memoryText(candidate));

    const existingCoveredByCandidate = existingValues.some((value) =>
      value ? candidateText.includes(value) : false,
    );
    const candidateCoveredByExisting = candidateValues.some((value) =>
      value ? existingText.includes(value) : false,
    );

    if (!existingCoveredByCandidate && !candidateCoveredByExisting) {
      return false;
    }

    const sharedValues = existingValues.filter((value) => value && candidateValues.includes(value));

    if (sharedValues.length > 0) {
      return false;
    }

    return this.memoryCompatibility(existing, candidate) < 0.5;
  }

  private scalarMap(value: unknown): Map<string, string> {
    const output = new Map<string, string>();

    const visit = (node: unknown, path: string[]): void => {
      if (node === null || node === undefined) return;

      if (Array.isArray(node)) {
        for (const item of node) {
          visit(item, path);
        }
        return;
      }

      if (typeof node === 'object') {
        for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
          visit(child, [...path, normalizeMemoryText(key)]);
        }
        return;
      }

      const key = path.filter(Boolean).join('.');
      const scalar = normalizeMemoryText(node);

      if (!key || !scalar) return;
      output.set(key, scalar);
    };

    visit(value, []);

    return output;
  }

  private scalarValues(value: unknown): string[] {
    const output: string[] = [];

    const visit = (node: unknown): void => {
      if (node === null || node === undefined) return;

      if (Array.isArray(node)) {
        for (const item of node) {
          visit(item);
        }
        return;
      }

      if (typeof node === 'object') {
        for (const child of Object.values(node as Record<string, unknown>)) {
          visit(child);
        }
        return;
      }

      const scalar = normalizeMemoryText(node);
      if (scalar) output.push(scalar);
    };

    visit(value);

    return Array.from(new Set(output));
  }

  private structuredTokens(value: unknown): string[] {
    const output: string[] = [];

    const visit = (node: unknown): void => {
      if (node === null || node === undefined) return;

      if (Array.isArray(node)) {
        for (const item of node) {
          visit(item);
        }
        return;
      }

      if (typeof node === 'object') {
        for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
          const normalizedKey = normalizeMemoryText(key);
          if (normalizedKey) output.push(`key:${normalizedKey}`);
          visit(child);
        }
        return;
      }

      const text = normalizeMemoryText(node);
      if (!text) return;

      output.push(`value:${text}`);

      const anchors = this.anchorTokens(text);
      for (const anchor of anchors) {
        output.push(`anchor:${anchor}`);
      }
    };

    visit(value);

    return Array.from(new Set(output));
  }

  private memoryText(input: MemoryFactRecord | MemoryCandidate): string {
    const value = 'valueJson' in input ? input.valueJson : input.value;

    return [
      input.kind,
      input.scopeLevel,
      input.subject,
      input.predicate,
      input.summary,
      JSON.stringify(value ?? ''),
      ...('tags' in input ? (input.tags ?? []) : []),
    ]
      .join(' ')
      .trim();
  }

  private valueText(input: MemoryFactRecord | MemoryCandidate): string {
    const value = 'valueJson' in input ? input.valueJson : input.value;
    return normalizeMemoryText(JSON.stringify(value ?? ''));
  }

  private memoryCompatibility(existing: MemoryFactRecord, candidate: MemoryCandidate): number {
    const summaryScore = this.textSimilarity(existing.summary, candidate.summary);
    const valueScore = this.textSimilarity(existing.valueJson, candidate.value);
    const fullScore = this.textSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const anchorScore = this.anchorSimilarity(this.memoryText(existing), this.memoryText(candidate));
    const structuredScore = this.structuredValueSimilarity(existing.valueJson, candidate.value);
    const existingValueCoverage = this.valueCoverage(existing.valueJson, candidate);
    const candidateValueCoverage = this.valueCoverage(candidate.value, existing);

    return Math.max(
      structuredScore,
      valueScore,
      summaryScore * 0.86,
      fullScore * 0.92,
      anchorScore * 0.78,
      existingValueCoverage * 0.72,
      candidateValueCoverage * 0.72,
    );
  }

  private valueCoverage(value: unknown, target: MemoryFactRecord | MemoryCandidate): number {
    const valueTokens = this.tokens(value);
    const targetTokens = this.tokens(this.memoryText(target));

    if (!valueTokens.length || !targetTokens.length) return 0;

    const valueSet = new Set(valueTokens);
    const targetSet = new Set(targetTokens);

    let intersection = 0;
    for (const token of valueSet) {
      if (targetSet.has(token)) intersection += 1;
    }

    return intersection / valueSet.size;
  }

  private textSimilarity(left: unknown, right: unknown): number {
    return memoryTokenJaccard(this.tokens(left), this.tokens(right));
  }

  private tokens(value: unknown): string[] {
    return memoryLexicalTokens(normalizeMemoryText(value));
  }

  private containsSentence(container: string, target: string): boolean {
    const normalizedContainer = normalizeMemoryText(container);
    const normalizedTarget = normalizeMemoryText(target);

    if (!normalizedContainer || !normalizedTarget) return false;
    return normalizedContainer.includes(normalizedTarget);
  }

  private normalizeForDisplay(value: unknown): string {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }
}