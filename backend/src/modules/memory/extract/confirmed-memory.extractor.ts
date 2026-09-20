                                                                   
import { Injectable } from '@nestjs/common';
import { MemoryCandidateNormalizer } from './memory-candidate-normalizer.service';
import type { MemoryCandidate } from '../kernel/memory.types';
import type { MemoryWriteFrame } from '../frames/memory-frame.types';
import { cleanMemoryText } from '../shared/memory-primitives';

@Injectable()
export class ConfirmedMemoryExtractor {
  constructor(private readonly normalizer: MemoryCandidateNormalizer) {}

  extract(frame: MemoryWriteFrame): MemoryCandidate[] {
    const candidates = frame.confirmedCandidates ?? [];

    if (candidates.length > 0) {
      return this.normalizer.normalizeMany(
        candidates.map((candidate) => this.withFrameEvidence(candidate, frame)),
      );
    }

    if (frame.intent === 'forget' && frame.explicitness === 'explicit') {
      const forgetCandidate = this.buildForgetCandidate(frame);
      return forgetCandidate ? this.normalizer.normalizeMany([forgetCandidate]) : [];
    }

    return [];
  }

  private withFrameEvidence(
    candidate: Partial<MemoryCandidate>,
    frame: MemoryWriteFrame,
  ): Partial<MemoryCandidate> {
    return {
      ...candidate,
      confidence: Math.max(candidate.confidence ?? 0, 0.95),
      evidence: {
        ...candidate.evidence,
        conversationId: candidate.evidence?.conversationId ?? frame.source.conversationId ?? null,
        userMessageId: candidate.evidence?.userMessageId ?? frame.source.userMessageId ?? null,
        assistantMessageId: candidate.evidence?.assistantMessageId ?? frame.source.assistantMessageId ?? null,
        traceId: candidate.evidence?.traceId ?? frame.source.traceId ?? null,
        source: candidate.evidence?.source ?? 'user_confirmed',
      },
    };
  }

  private buildForgetCandidate(frame: MemoryWriteFrame): Partial<MemoryCandidate> | null {
    const targetText = this.extractForgetTargetText(frame);

    if (!targetText) return null;

    return {
      scopeLevel: this.inferScopeLevel(frame),
      kind: 'preference',
      stability: 'long_term',
      sensitivity: 'normal',
      subject: this.subjectFromText(targetText),
      predicate: 'forget',
      summary: targetText,
      value: {
        target: targetText,
      },
      confidence: Math.max(frame.confidence ?? 0, 0.95),
      evidence: {
        source: 'user_confirmed',
        conversationId: frame.source.conversationId ?? null,
        userMessageId: frame.source.userMessageId ?? null,
        assistantMessageId: frame.source.assistantMessageId ?? null,
        traceId: frame.source.traceId ?? null,
        quote: targetText,
      },
      tags: ['forget'],
      sourceHash: null,
    };
  }

  private extractForgetTargetText(frame: MemoryWriteFrame): string | null {
  const userText = cleanMemoryText(frame.userText);
  if (userText) return userText;

  const memoryChanges = this.extractMemoryChanges(frame.assistantText);
  if (memoryChanges) return memoryChanges;

  const assistantText = cleanMemoryText(frame.assistantText);
  if (assistantText) return assistantText;

  return null;
}

  private extractMemoryChanges(text: string | null | undefined): string | null {
    const raw = String(text ?? '');
    if (!raw.trim()) return null;

    const blockMatch = raw.match(/<memory_changes>([\s\S]*?)<\/memory_changes>/i);
    const block = blockMatch?.[1] ?? raw;

    const lines = block
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean);

    const meaningful = lines
      .map((line) => cleanMemoryText(line))
      .filter((line): line is string => Boolean(line))
      .filter((line) => !/^<[^>]+>$/.test(line));

    if (!meaningful.length) return null;

    return meaningful.join(' ').slice(0, 600);
  }

  private inferScopeLevel(frame: MemoryWriteFrame): MemoryCandidate['scopeLevel'] {
    const namespace = frame.namespace as Partial<{
      scopeLevel: MemoryCandidate['scopeLevel'];
      level: MemoryCandidate['scopeLevel'];
      type: MemoryCandidate['scopeLevel'];
    }>;

    return namespace.scopeLevel ?? namespace.level ?? namespace.type ?? 'user';
  }

  private subjectFromText(text: string): string {
    const normalized = cleanMemoryText(text) ?? 'memory';
    return normalized.slice(0, 160);
  }

}