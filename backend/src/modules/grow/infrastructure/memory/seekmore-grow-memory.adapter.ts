import { Injectable } from '@nestjs/common';
import { MemoryFacade } from '../../../memory/facade/memory.facade';
import type { GrowMemoryPort } from '../../ports/grow-memory.port';

@Injectable()
export class SeekmoreGrowMemoryAdapter implements GrowMemoryPort {
  constructor(private readonly memory: MemoryFacade) {}

  async write(input: Parameters<GrowMemoryPort['write']>[0]) {
    const result = await this.memory.writeBack({
      user: { id: input.userId },
      scope: { agentId: input.agentId },
      intent: 'remember',
      explicitness: input.confidence >= 0.9 ? 'explicit' : 'implicit',
      userText: input.statement,
      confirmedCandidates: [],
      operationSource: 'system',
      operationActor: { userId: input.userId, agentId: input.agentId, role: 'grow' },
      reason: `grow_review:${input.sourceReviewId}`,
    });
    return { memoryId: this.memoryId(result) ?? `grow:${input.sourceReviewId}` };
  }

  private memoryId(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    for (const key of ['memoryId', 'id', 'factId']) {
      const candidate = String(row[key] ?? '').trim();
      if (candidate) return candidate;
    }
    const list = row.created ?? row.items ?? row.memories;
    if (Array.isArray(list) && list.length) return this.memoryId(list[0]);
    return null;
  }
}
