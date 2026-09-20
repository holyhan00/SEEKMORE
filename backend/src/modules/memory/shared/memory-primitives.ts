import type {
  MemoryKind,
  MemorySensitivity,
  MemoryStability,
} from '../kernel/memory.constants';
import type { MemoryCandidate } from '../kernel/memory.types';

export function normalizeMemoryText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function cleanMemoryText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function memoryCharacterNgrams(
  text: string,
  min: number,
  max: number,
): string[] {
  const chars = Array.from(text);
  const output: string[] = [];

  for (let size = min; size <= max; size += 1) {
    for (let index = 0; index + size <= chars.length; index += 1) {
      output.push(chars.slice(index, index + size).join(''));
    }
  }

  return output;
}

export function memoryLexicalTokens(text: string): string[] {
  if (!text) return [];

  const latinTokens = text.match(/[a-z0-9][a-z0-9_-]{1,}/gi) ?? [];
  const chineseChunks = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const chineseNgrams = chineseChunks.flatMap((chunk) =>
    memoryCharacterNgrams(chunk, 2, 4),
  );

  return Array.from(new Set([...latinTokens, ...chineseChunks, ...chineseNgrams]));
}

export function memoryTokenJaccard(
  leftTokens: readonly string[],
  rightTokens: readonly string[],
): number {
  if (!leftTokens.length || !rightTokens.length) return 0;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}

export function memoryKindGroup(kind: MemoryKind | string): string {
  if (kind === 'event' || kind === 'episode') return 'event';
  if (kind === 'project_state') return 'state';
  if (kind === 'identity') return 'identity';
  if (kind === 'relationship') return 'relationship';
  return 'stable_fact';
}

export function uniqueMemoryJsonValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const output: unknown[] = [];

  for (const value of values) {
    const key = JSON.stringify(value ?? null);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }

  return output;
}

export function strongerMemoryStability(
  left: MemoryStability,
  right: MemoryStability,
): MemoryStability {
  const rank: Record<MemoryStability, number> = {
    ephemeral: 0,
    session: 1,
    long_term: 2,
  };

  return rank[left] >= rank[right] ? left : right;
}

export function strongerMemorySensitivity(
  left: MemorySensitivity,
  right: MemorySensitivity,
): MemorySensitivity {
  const rank: Record<MemorySensitivity, number> = {
    normal: 0,
    private: 1,
    sensitive: 2,
    restricted: 3,
  };

  return rank[left] >= rank[right] ? left : right;
}

export function isDurableMemoryCandidate(candidate: MemoryCandidate): boolean {
  if (candidate.stability !== 'long_term') return false;

  return (
    candidate.kind === 'identity' ||
    candidate.kind === 'preference' ||
    candidate.kind === 'constraint' ||
    candidate.kind === 'project_state' ||
    candidate.kind === 'goal' ||
    candidate.kind === 'relationship' ||
    candidate.kind === 'workflow' ||
    candidate.kind === 'tool_preference'
  );
}
