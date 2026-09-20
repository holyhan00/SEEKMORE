                                                           
import { Injectable, Logger } from '@nestjs/common';
import { MemoryRetriever } from '../retrieval/memory-retriever.service';
import { MemoryContextComposer } from '../retrieval/memory-context-composer.service';
import { MemoryRepository } from '../storage/prisma/memory.repository';
import type {
  BuildMemoryContextInput,
  BuildMemoryContextOutput,
  MemoryRetrievalItem,
} from './memory.types';

@Injectable()
export class MemoryReadRuntime {
  private readonly logger = new Logger(MemoryReadRuntime.name);

  constructor(
    private readonly retriever: MemoryRetriever,
    private readonly composer: MemoryContextComposer,
    private readonly repo: MemoryRepository,
  ) {}

  async buildContext(input: BuildMemoryContextInput): Promise<BuildMemoryContextOutput> {
    const query = String(input.query ?? '').trim();

    if (!query) {
      return {
        blocks: [],
        retrieved: [],
        skipped: true,
        reason: 'empty_query',
      };
    }

    const limit = input.maxItems ?? 12;

    const [retrievedByQuery, alwaysOn] = await Promise.all([
      this.retriever.retrieve({
        namespace: input.namespace,
        query,
        limit,
      }),
      this.repo.listAlwaysOnFactsForContext({
        namespace: input.namespace,
        limit: Math.min(limit, 8),
      }),
    ]);

    const retrieved = this.mergeRetrieved([...alwaysOn, ...retrievedByQuery], limit);

    const blocks = this.composer.compose({
      namespace: input.namespace,
      items: retrieved,
      maxItems: input.maxItems,
      maxChars: input.maxChars,
    });

    this.logger.log(
      `[MemoryRead] trace=${input.traceId ?? '-'} user=${input.namespace.userId} retrieved=${retrieved.length} query=${retrievedByQuery.length} alwaysOn=${alwaysOn.length} blocks=${blocks.length}`,
    );

    return {
      blocks,
      retrieved,
      skipped: false,
    };
  }

  private mergeRetrieved(items: MemoryRetrievalItem[], limit: number): MemoryRetrievalItem[] {
    const output = new Map<string, MemoryRetrievalItem>();

    for (const item of items) {
      if (!output.has(item.id)) {
        output.set(item.id, item);
      }
    }

    return Array.from(output.values()).slice(0, limit);
  }
}