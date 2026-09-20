import { Injectable } from '@nestjs/common';
import type { MemoryCandidate } from '../kernel/memory.types';

@Injectable()
export class MemoryRetentionPolicy {
  shouldPersist(candidate: MemoryCandidate): boolean {
    return candidate.stability !== 'ephemeral' || candidate.confidence >= 0.95;
  }
}
