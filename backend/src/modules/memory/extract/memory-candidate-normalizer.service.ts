                                                                            
import { Injectable } from '@nestjs/common';
import type { MemoryCandidate } from '../kernel/memory.types';
import type {
  MemoryKind,
  MemoryScopeLevel,
  MemorySensitivity,
  MemoryStability,
} from '../kernel/memory.constants';
import {
  cleanMemoryText,
  memoryKindGroup,
  memoryLexicalTokens,
  memoryTokenJaccard,
  normalizeMemoryText,
  strongerMemorySensitivity,
  strongerMemoryStability,
  uniqueMemoryJsonValues,
} from '../shared/memory-primitives';

const ALLOWED_KINDS = new Set<MemoryKind>([
  'identity',
  'preference',
  'constraint',
  'project_state',
  'goal',
  'relationship',
  'workflow',
  'tool_preference',
  'event',
  'episode',
]);

const ALLOWED_SCOPES = new Set<MemoryScopeLevel>([
  'user',
  'agent',
  'conversation',
  'project',
  'org',
  'group',
  'plan',
]);

const ALLOWED_STABILITY = new Set<MemoryStability>([
  'long_term',
  'session',
  'ephemeral',
]);

const ALLOWED_SENSITIVITY = new Set<MemorySensitivity>([
  'normal',
  'private',
  'sensitive',
  'restricted',
]);

@Injectable()
export class MemoryCandidateNormalizer {
  normalize(candidate: Partial<MemoryCandidate>): MemoryCandidate | null {
    const kind = this.oneOf(candidate.kind, ALLOWED_KINDS);
    const scopeLevel = this.oneOf(candidate.scopeLevel, ALLOWED_SCOPES);
    const stability = this.oneOf(candidate.stability, ALLOWED_STABILITY);
    const sensitivity = this.oneOf(candidate.sensitivity, ALLOWED_SENSITIVITY) ?? 'normal';

    const subject = cleanMemoryText(candidate.subject);
    const predicate = cleanMemoryText(candidate.predicate);
    const summary = cleanMemoryText(candidate.summary);
    const evidence = candidate.evidence;

    if (!kind || !scopeLevel || !stability || !subject || !predicate || !summary) {
      return null;
    }

    if (!evidence?.source) {
      return null;
    }

    const value = candidate.value ?? summary;

    const normalized: MemoryCandidate = {
      kind,
      scopeLevel,
      stability,
      sensitivity,
      subject: subject.slice(0, 160),
      predicate: predicate.slice(0, 120),
      summary: summary.slice(0, 600),
      value,
      confidence: this.confidence(candidate.confidence),
      evidence: {
        source: evidence.source,
        conversationId: evidence.conversationId ?? null,
        userMessageId: evidence.userMessageId ?? null,
        assistantMessageId: evidence.assistantMessageId ?? null,
        traceId: evidence.traceId ?? null,
        quote: cleanMemoryText(evidence.quote)?.slice(0, 800) ?? null,
      },
      tags: Array.isArray(candidate.tags)
        ? (candidate.tags
            .map((tag) => cleanMemoryText(tag))
            .filter(Boolean)
            .slice(0, 12) as string[])
        : [],
      sourceHash: null,
    };

    return {
      ...normalized,
      sourceHash: this.hash(this.signatureText(normalized)),
    };
  }

  normalizeMany(candidates: Array<Partial<MemoryCandidate>>): MemoryCandidate[] {
    const out: MemoryCandidate[] = [];

    for (const candidate of candidates) {
      const normalized = this.normalize(candidate);
      if (!normalized) continue;

      const existingIndex = out.findIndex((item) => this.shouldCollapse(item, normalized));

      if (existingIndex < 0) {
        out.push(normalized);
        continue;
      }

      out[existingIndex] = this.mergeCandidate(out[existingIndex], normalized);
    }

    return out;
  }

  private shouldCollapse(existing: MemoryCandidate, incoming: MemoryCandidate): boolean {
    if (existing.scopeLevel !== incoming.scopeLevel) return false;

    const existingGroup = memoryKindGroup(existing.kind);
    const incomingGroup = memoryKindGroup(incoming.kind);

    if (existingGroup !== incomingGroup) return false;

    const subjectScore = this.textSimilarity(existing.subject, incoming.subject);
    const predicateScore = this.textSimilarity(existing.predicate, incoming.predicate);
    const summaryScore = this.textSimilarity(existing.summary, incoming.summary);
    const valueScore = this.textSimilarity(existing.value, incoming.value);
    const fullScore = this.textSimilarity(this.signatureText(existing), this.signatureText(incoming));

    if (subjectScore >= 0.78 && predicateScore >= 0.72) return true;
    if (fullScore >= 0.68) return true;
    if (subjectScore >= 0.62 && summaryScore >= 0.62) return true;
    if (predicateScore >= 0.62 && valueScore >= 0.62) return true;

    return false;
  }

  private mergeCandidate(left: MemoryCandidate, right: MemoryCandidate): MemoryCandidate {
    const base = left.confidence >= right.confidence ? left : right;
    const other = base === left ? right : left;

    const merged: MemoryCandidate = {
      ...base,
      subject: this.pickRepresentativeText(base.subject, other.subject),
      predicate: this.pickRepresentativeText(base.predicate, other.predicate),
      summary: this.mergeText(base.summary, other.summary, 600),
      value: this.mergeValue(base.value, other.value),
      confidence: Math.max(left.confidence, right.confidence),
      stability: strongerMemoryStability(left.stability, right.stability),
      sensitivity: strongerMemorySensitivity(left.sensitivity, right.sensitivity),
      evidence: {
        ...base.evidence,
        quote: this.mergeNullableText(base.evidence.quote, other.evidence.quote, 800),
      },
      tags: this.mergeTags(left.tags, right.tags),
      sourceHash: null,
    };

    return {
      ...merged,
      sourceHash: this.hash(this.signatureText(merged)),
    };
  }

  private pickRepresentativeText(left: string, right: string): string {
    const normalizedLeft = normalizeMemoryText(left);
    const normalizedRight = normalizeMemoryText(right);

    if (!normalizedLeft) return right;
    if (!normalizedRight) return left;

    if (normalizedLeft.includes(normalizedRight)) return left;
    if (normalizedRight.includes(normalizedLeft)) return right;

    return left.length >= right.length ? left : right;
  }

  private mergeText(left: string, right: string, maxLength: number): string {
    const normalizedLeft = normalizeMemoryText(left);
    const normalizedRight = normalizeMemoryText(right);

    if (!normalizedLeft) return right.slice(0, maxLength);
    if (!normalizedRight) return left.slice(0, maxLength);

    if (normalizedLeft.includes(normalizedRight)) return left.slice(0, maxLength);
    if (normalizedRight.includes(normalizedLeft)) return right.slice(0, maxLength);

    if (this.textSimilarity(left, right) >= 0.86) {
      return (left.length >= right.length ? left : right).slice(0, maxLength);
    }

    return `${left} ${right}`.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  private mergeNullableText(
    left: string | null | undefined,
    right: string | null | undefined,
    maxLength: number,
  ): string | null {
    const merged = this.mergeText(left ?? '', right ?? '', maxLength);
    return merged || null;
  }

  private mergeValue(left: unknown, right: unknown): unknown {
    const leftText = normalizeMemoryText(JSON.stringify(left ?? ''));
    const rightText = normalizeMemoryText(JSON.stringify(right ?? ''));

    if (!leftText) return right;
    if (!rightText) return left;

    if (leftText === rightText) return left;
    if (leftText.includes(rightText)) return left;
    if (rightText.includes(leftText)) return right;

    if (this.textSimilarity(left, right) >= 0.86) return left;

    return {
      items: uniqueMemoryJsonValues([left, right]),
    };
  }

  private mergeTags(left?: string[], right?: string[]): string[] {
    return Array.from(
      new Set([...(left ?? []), ...(right ?? [])].map((tag) => tag.trim()).filter(Boolean)),
    ).slice(0, 12);
  }

  private signatureText(candidate: MemoryCandidate): string {
    return [
      candidate.scopeLevel,
      candidate.kind,
      candidate.subject,
      candidate.predicate,
      candidate.summary,
      JSON.stringify(candidate.value ?? ''),
      ...(candidate.tags ?? []),
    ]
      .join(' ')
      .trim();
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

  private confidence(value: unknown): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  private oneOf<T extends string>(value: unknown, allowed: Set<T>): T | null {
    const text = String(value ?? '').trim() as T;
    return allowed.has(text) ? text : null;
  }

  private hash(text: string): string {
    let h = 2166136261;

    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }

    return `h${(h >>> 0).toString(16)}`;
  }
}