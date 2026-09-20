                                                                  
import { Injectable } from '@nestjs/common';
import type { MemoryRetrievalItem } from '../kernel/memory.types';
import { MemoryDecayPolicy } from '../governance/memory-decay-policy.service';

@Injectable()
export class MemoryReranker {
  constructor(private readonly decay: MemoryDecayPolicy) {}

  rerank(input: { items: MemoryRetrievalItem[]; query: string; terms: string[] }): MemoryRetrievalItem[] {
    const now = Date.now();

    return input.items
      .map((item) => {
        const text = `${item.summary} ${JSON.stringify(item.valueJson ?? '')}`.toLowerCase();

        const lexical = input.terms.length
          ? input.terms.filter((term) => text.includes(term.toLowerCase())).length /
            Math.max(input.terms.length, 1)
          : 0;

        const ageDays = Math.max(0, (now - new Date(item.updatedAt).getTime()) / 86_400_000);
        const recency = 1 / (1 + ageDays / 30);

        const scopeBoost =
          item.scopeLevel === 'conversation'
            ? 0.08
            : item.scopeLevel === 'agent'
              ? 0.06
              : item.scopeLevel === 'project'
                ? 0.06
                : 0.03;

        const baseScore = lexical * 0.58 + item.confidence * 0.22 + recency * 0.12 + scopeBoost;
        const score = this.decay.score({ ...item, score: baseScore });

        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
  }
}