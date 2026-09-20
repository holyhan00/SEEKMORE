                                                                          
import { Injectable } from '@nestjs/common';
import {
  MEMORY_DEFAULT_MAX_INJECTED_CHARS,
  MEMORY_DEFAULT_MAX_INJECTED_ITEMS,
} from '../kernel/memory.constants';
import type {
  MemoryContextBlock,
  MemoryNamespace,
  MemoryRetrievalItem,
} from '../kernel/memory.types';

@Injectable()
export class MemoryContextComposer {
  compose(input: {
    namespace: MemoryNamespace;
    items: MemoryRetrievalItem[];
    maxItems?: number;
    maxChars?: number;
  }): MemoryContextBlock[] {
    const maxItems = Math.max(1, Math.min(input.maxItems ?? MEMORY_DEFAULT_MAX_INJECTED_ITEMS, 24));
    const maxChars = Math.max(800, Math.min(input.maxChars ?? MEMORY_DEFAULT_MAX_INJECTED_CHARS, 24_000));
    const selected: MemoryRetrievalItem[] = [];
    let chars = 0;

    for (const item of input.items) {
      const line = this.renderItem(item);
      if (!line) continue;
      if (selected.length >= maxItems) break;
      if (chars + line.length > maxChars) break;

      selected.push(item);
      chars += line.length;
    }

    if (!selected.length) return [];

    const content = [
      'Use these memory items only when directly relevant. Do not invent or expose memory beyond the current task.',
      ...selected.map((item, index) => `${index + 1}. ${this.renderItem(item)}`),
    ].join('\n');

    return [
      {
        id: `memory:${input.namespace.userId}:${input.namespace.agentId ?? 'global'}`,
        kind: 'memory_context',
        title: 'Relevant memory',
        content,
        metadata: {
          itemCount: selected.length,
          tokenCost: Math.ceil(content.length / 4),
          usedMemoryIds: selected.map((item) => item.id),
          citations: selected.map((item) => ({
            memoryId: item.id,
            sourceMessageId: item.source.userMessageId ?? null,
            sourceConversationId: item.source.conversationId ?? null,
          })),
          scope: input.namespace,
        },
      },
    ];
  }

  private renderItem(item: MemoryRetrievalItem): string {
    const summary = this.cleanBlockText(item.summary);
    const value = this.cleanBlockText(item.valueJson);
    const quote = this.cleanBlockText(item.source?.quote);

    const body = [summary, value, quote].filter(Boolean).join(' | ');
    if (!body) return '';

    return `[${item.scopeLevel}/${item.kind}] ${body} (confidence=${item.confidence.toFixed(
      2,
    )}, score=${item.score.toFixed(2)})`;
  }

  private cleanBlockText(value: unknown): string {
    return String(typeof value === 'string' ? value : JSON.stringify(value ?? ''))
      .replace(/```[\s\S]*?```/g, '')
      .replace(/<\/?memory[^>]*>/gi, '')
      .replace(/\bid=["'][^"']+["']/gi, '')
      .replace(/\[(?:MEMORY|记忆|CONTEXT|上下文)\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}