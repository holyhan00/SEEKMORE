                                                                       
import { Injectable } from '@nestjs/common';

@Injectable()
export class MemoryQueryPlanner {
  plan(query: string): { normalizedQuery: string; terms: string[] } {
    const normalizedQuery = String(query ?? '').replace(/\s+/g, ' ').trim();
    const terms = this.terms(normalizedQuery);
    return { normalizedQuery, terms };
  }

  private terms(text: string): string[] {
    const tokens = new Set<string>();
    for (const token of text.split(/[\s,，。.!?！？;；:：()（）\[\]{}<>《》"'“”‘’、/\\|]+/g)) {
      const clean = token.trim().toLowerCase();
      if (clean.length >= 2) tokens.add(clean);
    }

                                                                              
    const compact = text.replace(/[\s\p{P}\p{S}]/gu, '');
    if (compact.length >= 3) {
      for (let size = 2; size <= 4; size += 1) {
        for (let i = 0; i <= compact.length - size && tokens.size < 80; i += 1) {
          tokens.add(compact.slice(i, i + size).toLowerCase());
        }
      }
    }

    return Array.from(tokens).slice(0, 80);
  }
}
