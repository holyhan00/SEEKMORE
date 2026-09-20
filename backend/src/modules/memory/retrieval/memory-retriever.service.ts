import { Injectable } from '@nestjs/common';
import { MemoryRepository } from '../storage/prisma/memory.repository';
import { MemoryQueryPlanner } from './memory-query-planner.service';
import { MemoryReranker } from './memory-reranker.service';
import { MemoryTrustGate } from '../governance/trust-gate.service';
import type { MemoryNamespace, MemoryRetrievalItem } from '../kernel/memory.types';

@Injectable()
export class MemoryRetriever {
  constructor(
    private readonly repo: MemoryRepository,
    private readonly planner: MemoryQueryPlanner,
    private readonly reranker: MemoryReranker,
    private readonly trustGate: MemoryTrustGate,
  ) {}

  async retrieve(input: { namespace: MemoryNamespace; query: string; limit?: number }): Promise<MemoryRetrievalItem[]> {
    const plan = this.planner.plan(input.query);
    if (!plan.normalizedQuery) return [];
    const recalled = await this.repo.retrieve({ namespace: input.namespace, query: plan.normalizedQuery, terms: plan.terms, limit: input.limit ?? 40 });
    const ranked = this.reranker.rerank({ items: recalled, query: plan.normalizedQuery, terms: plan.terms });
    return this.trustGate.filter(ranked).slice(0, input.limit ?? 12);
  }
}
