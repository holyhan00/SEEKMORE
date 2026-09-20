import { Injectable } from '@nestjs/common';
import type { MemoryRetrievalItem } from '../kernel/memory.types';

@Injectable()
export class MemoryTrustGate {
  filter(items: MemoryRetrievalItem[]): MemoryRetrievalItem[] {
    return items.filter((item) => {
      if (item.sensitivity === 'restricted') return false;
      if (item.confidence < 0.45) return false;
      if (item.score < 0.12) return false;
      return true;
    });
  }
}
