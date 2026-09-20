import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../../../tools/toolstypes';
import { ToolError } from '../../../../tools/toolstypes';
import { KnowledgeRetrievalService } from '../knowledge-retrieval.service';

@Injectable()
export class KnowledgeSearchTool implements Tool {
  readonly name = 'knowledge.search';
  readonly version = '1.0.0';
  readonly runtimeOnly = true;
  readonly description =
    'Search the current Cognitive Agent private knowledge base for relevant source material. Use it when the task depends on facts or reference material likely stored in this Agent knowledge files.';
  readonly tags = ['knowledge', 'rag', 'search', 'read'];
  readonly timeoutMs = 45_000;
  readonly maxOutputBytes = 64 * 1024;
  readonly inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 1000,
        description: 'A focused search query for the information needed from the current Agent knowledge base.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        default: 6,
        description: 'Maximum number of relevant knowledge chunks to return.',
      },
    },
  };
  readonly outputSchema = {
    type: 'object',
    required: ['query', 'resultCount', 'results'],
    properties: {
      query: { type: 'string' },
      resultCount: { type: 'integer' },
      results: { type: 'array' },
    },
    additionalProperties: false,
  };
  readonly sideEffectClass = 'read_only' as const;
  readonly idempotency = 'optional' as const;
  readonly requiresApproval = false;
  readonly providerKind = 'knowledge' as const;
  readonly capabilityKinds = ['knowledge.search'];
  readonly sourceTypes: NonNullable<Tool['sourceTypes']> = ['knowledge'];
  readonly riskLevel = 'low' as const;
  readonly requiredSurfaces: NonNullable<Tool['requiredSurfaces']> = ['conversation'];
  readonly parallelism: NonNullable<Tool['parallelism']> = 'parallel_safe';
  readonly presentation: NonNullable<Tool['presentation']> = 'activity';
  readonly latencyClass: NonNullable<Tool['latencyClass']> = 'short';
  readonly supportsAbort = false;

  constructor(private readonly retrieval: KnowledgeRetrievalService) {}

  async canExecute(ctx: ToolContext): Promise<boolean> {
    const agentId = this.agentId(ctx);
    if (!agentId) return false;

    return this.retrieval.hasReadyKnowledge({
      userId: ctx.userId,
      agentId,
    });
  }

  async execute(args: Dict, ctx: ToolContext) {
    const agentId = this.agentId(ctx);
    if (!agentId) {
      throw new ToolError(
        'KNOWLEDGE_AGENT_CONTEXT_MISSING',
        'Current Agent context is required for knowledge search',
      );
    }

    const query = String(args.query ?? '').trim();
    if (!query) {
      throw new ToolError(
        'KNOWLEDGE_SEARCH_QUERY_REQUIRED',
        'Knowledge search query is required',
      );
    }

    const limit = Math.max(
      1,
      Math.min(10, Math.trunc(Number(args.limit ?? 6) || 6)),
    );

    const hits = await this.retrieval.search({
      userId: ctx.userId,
      agentId,
      query,
      limit,
    });

    return {
      query,
      resultCount: hits.length,
      results: hits.map((hit) => ({
        chunkId: hit.chunkId,
        objectId: hit.objectId,
        source: this.source(hit.sourceName, hit.chunkIndex, hit.meta),
        content: hit.content,
        ...(hit.truncated ? { truncated: true } : {}),
      })),
    };
  }

  private agentId(ctx: ToolContext): string {
    return String(ctx.metadata?.agentId ?? '').trim();
  }

  private source(
    sourceName: string | null | undefined,
    chunkIndex: number,
    value: unknown,
  ): Record<string, unknown> {
    const meta = this.record(value);
    const page = this.firstPositiveInteger(
      meta.page,
      meta.pageNumber,
    );
    const title = this.firstText(
      meta.title,
      meta.tableTitle,
      meta.section,
      meta.heading,
    );
    const sheetName = this.firstText(meta.sheetName, meta.sheet);
    const rowStart = this.nonNegativeInteger(meta.rowStart);
    const rowEnd = this.nonNegativeInteger(meta.rowEnd);

    return {
      name: sourceName ?? null,
      chunkIndex,
      ...(page != null ? { page } : {}),
      ...(title ? { section: title } : {}),
      ...(sheetName ? { sheetName } : {}),
      ...(rowStart != null ? { rowStart } : {}),
      ...(rowEnd != null ? { rowEnd } : {}),
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private firstText(...values: unknown[]): string | null {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text.slice(0, 500);
    }
    return null;
  }

  private firstPositiveInteger(...values: unknown[]): number | null {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return null;
  }

  private nonNegativeInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }
}
