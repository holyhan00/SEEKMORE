                                                                     

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import type {
  KnowledgeSearchHit,
  KnowledgeSearchOptions,
} from './knowledge.types';

type VectorRow = {
  id: string;
  objectId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  sourceName: string | null;
  meta: unknown;
  vectorSimilarity: number;
};

type LexicalRow = {
  id: string;
  objectId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  sourceName: string | null;
  meta: unknown;
  lexicalScore: number;
};

type FusedCandidate = {
  chunkId: string;
  objectId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  sourceName: string | null;
  meta: unknown;
  score: number;
  vectorSimilarity?: number;
  lexicalScore?: number;
  retrievalSources: Set<'vector' | 'lexical'>;
};

@Injectable()
export class KnowledgeRetrievalService {
  private readonly logger = new Logger(KnowledgeRetrievalService.name);
  private readonly defaultLimit = 6;
  private readonly maxLimit = 10;
  private readonly defaultMaxChars = 8000;
  private readonly maxChars = 16000;
  private readonly candidateLimit = 24;
  private readonly rrfK = 60;
  private readonly minVectorSimilarity = this.resolveMinVectorSimilarity();

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: KnowledgeEmbeddingService,
  ) {}

  async hasReadyKnowledge(input: { userId: string; agentId: string }): Promise<boolean> {
    const userId = String(input.userId ?? '').trim();
    const agentId = String(input.agentId ?? '').trim();
    if (!userId || !agentId) return false;

    const [agentCount, objectCount] = await Promise.all([
      this.prisma.agent.count({
        where: {
          id: agentId,
          userId,
          deletedAt: null,
          isActive: true,
          knowledgeEnabled: true,
        },
      }),
      this.prisma.agentKnowledgeObject.count({
        where: {
          userId,
          agentId,
          deletedAt: null,
          parseStatus: 'READY',
        },
      }),
    ]);

    return agentCount > 0 && objectCount > 0;
  }

  async search(options: KnowledgeSearchOptions): Promise<KnowledgeSearchHit[]> {
    const userId = String(options.userId || '').trim();
    const agentId = String(options.agentId || '').trim();
    const query = this.normalizeQuery(options.query);

    if (!userId || !agentId || !query) return [];

    const limit = this.clampInteger(
      options.limit,
      this.defaultLimit,
      1,
      this.maxLimit,
    );
    const maxChars = this.clampInteger(
      options.maxChars,
      this.defaultMaxChars,
      1000,
      this.maxChars,
    );

    const [vectorRows, lexicalRows] = await Promise.all([
      this.searchVector({ userId, agentId, query }),
      this.searchLexical({ userId, agentId, query }),
    ]);

    const fused = this.fuse(vectorRows, lexicalRows);
    return this.applyResultBudget(fused, limit, maxChars);
  }

  private async searchVector(params: {
    userId: string;
    agentId: string;
    query: string;
  }): Promise<VectorRow[]> {
    if (!this.embedding.isEnabled()) return [];

    let vector: number[] | null = null;
    try {
      vector = await this.embedding.embed(params.query);
    } catch (error) {
      this.logger.warn(
        `Knowledge vector query failed; lexical retrieval will continue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }

    if (!vector) return [];

    const rows = await this.prisma.$queryRawUnsafe<VectorRow[]>(
      `
        SELECT
          c.id,
          c.object_id AS "objectId",
          c.chunk_index AS "chunkIndex",
          c.content,
          c.token_count AS "tokenCount",
          o.original_name AS "sourceName",
          c.meta,
          (1 - (c.embedding <=> $1::vector))::double precision AS "vectorSimilarity"
        FROM agent_knowledge_chunk c
        INNER JOIN agent_knowledge_object o
          ON o.id = c.object_id
        WHERE c.user_id = $2
          AND c.agent_id = $3
          AND o.user_id = $2
          AND o.agent_id = $3
          AND o.deleted_at IS NULL
          AND o.parse_status::text = 'READY'
          AND c.embedding IS NOT NULL
          AND c.embedding_model = $4
        ORDER BY c.embedding <=> $1::vector ASC
        LIMIT $5
      `,
      this.embedding.toVectorLiteral(vector),
      params.userId,
      params.agentId,
      this.embedding.model,
      this.candidateLimit,
    );

    return rows
      .map((row) => ({
        ...row,
        vectorSimilarity: Number(row.vectorSimilarity),
      }))
      .filter(
        (row) =>
          Number.isFinite(row.vectorSimilarity)
          && row.vectorSimilarity >= this.minVectorSimilarity,
      );
  }

  private async searchLexical(params: {
    userId: string;
    agentId: string;
    query: string;
  }): Promise<LexicalRow[]> {
    const terms = this.extractLexicalTerms(params.query);
    if (!terms.length) return [];

    const sqlParams: unknown[] = [params.userId, params.agentId];
    const scoreParts: string[] = [];
    const matchParts: string[] = [];

    terms.forEach((term) => {
      const parameterIndex = sqlParams.length + 1;
      const weight = this.lexicalWeight(term);
      sqlParams.push(term);
      scoreParts.push(
        `(CASE WHEN POSITION($${parameterIndex} IN LOWER(c.content)) > 0 THEN ${weight} ELSE 0 END)`,
      );
      scoreParts.push(
        `(CASE WHEN POSITION($${parameterIndex} IN LOWER(o.original_name)) > 0 THEN ${Math.max(1, weight * 0.5)} ELSE 0 END)`,
      );
      matchParts.push(
        `(POSITION($${parameterIndex} IN LOWER(c.content)) > 0 OR POSITION($${parameterIndex} IN LOWER(o.original_name)) > 0)`,
      );
    });

    const limitParam = sqlParams.length + 1;
    sqlParams.push(this.candidateLimit);

    const rows = await this.prisma.$queryRawUnsafe<LexicalRow[]>(
      `
        SELECT
          c.id,
          c.object_id AS "objectId",
          c.chunk_index AS "chunkIndex",
          c.content,
          c.token_count AS "tokenCount",
          o.original_name AS "sourceName",
          c.meta,
          (${scoreParts.join(' + ')})::double precision AS "lexicalScore"
        FROM agent_knowledge_chunk c
        INNER JOIN agent_knowledge_object o
          ON o.id = c.object_id
        WHERE c.user_id = $1
          AND c.agent_id = $2
          AND o.user_id = $1
          AND o.agent_id = $2
          AND o.deleted_at IS NULL
          AND o.parse_status::text = 'READY'
          AND (${matchParts.join(' OR ')})
        ORDER BY "lexicalScore" DESC, c.created_at DESC, c.chunk_index ASC
        LIMIT $${limitParam}
      `,
      ...sqlParams,
    );

    return rows
      .map((row) => ({
        ...row,
        lexicalScore: Number(row.lexicalScore),
      }))
      .filter((row) => Number.isFinite(row.lexicalScore) && row.lexicalScore > 0);
  }

  private fuse(
    vectorRows: VectorRow[],
    lexicalRows: LexicalRow[],
  ): FusedCandidate[] {
    const candidates = new Map<string, FusedCandidate>();

    const ensure = (
      row: VectorRow | LexicalRow,
    ): FusedCandidate => {
      const existing = candidates.get(row.id);
      if (existing) return existing;

      const created: FusedCandidate = {
        chunkId: row.id,
        objectId: row.objectId,
        chunkIndex: row.chunkIndex,
        content: row.content,
        tokenCount: row.tokenCount,
        sourceName: row.sourceName,
        meta: row.meta,
        score: 0,
        retrievalSources: new Set(),
      };
      candidates.set(row.id, created);
      return created;
    };

    vectorRows.forEach((row, index) => {
      const candidate = ensure(row);
      candidate.score += 1 / (this.rrfK + index + 1);
      candidate.vectorSimilarity = row.vectorSimilarity;
      candidate.retrievalSources.add('vector');
    });

    lexicalRows.forEach((row, index) => {
      const candidate = ensure(row);
      candidate.score += 1 / (this.rrfK + index + 1);
      candidate.lexicalScore = row.lexicalScore;
      candidate.retrievalSources.add('lexical');
    });

    return [...candidates.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const vectorDelta =
        (b.vectorSimilarity ?? Number.NEGATIVE_INFINITY)
        - (a.vectorSimilarity ?? Number.NEGATIVE_INFINITY);
      if (vectorDelta !== 0) return vectorDelta;

      return (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0);
    });
  }

  private applyResultBudget(
    candidates: FusedCandidate[],
    limit: number,
    maxChars: number,
  ): KnowledgeSearchHit[] {
    const selected: KnowledgeSearchHit[] = [];
    let usedChars = 0;

    for (const candidate of candidates) {
      if (selected.length >= limit || usedChars >= maxChars) break;

      const remaining = maxChars - usedChars;
      const sourceContent = String(candidate.content || '').trim();
      if (!sourceContent) continue;

      const truncated = sourceContent.length > remaining;
      const content = truncated
        ? sourceContent.slice(0, remaining).trimEnd()
        : sourceContent;
      if (!content) continue;

      selected.push({
        chunkId: candidate.chunkId,
        objectId: candidate.objectId,
        chunkIndex: candidate.chunkIndex,
        content,
        tokenCount: candidate.tokenCount,
        sourceName: candidate.sourceName,
        meta: candidate.meta,
        score: candidate.score,
        vectorSimilarity: candidate.vectorSimilarity,
        lexicalScore: candidate.lexicalScore,
        retrievalSources: [...candidate.retrievalSources],
        ...(truncated ? { truncated: true } : {}),
      });

      usedChars += content.length;
    }

    return selected;
  }

  private extractLexicalTerms(query: string): string[] {
    const normalized = this.normalizeQuery(query).toLowerCase();
    const terms: string[] = [];
    const seen = new Set<string>();

    const add = (value: string) => {
      const term = value.trim();
      if (term.length < 2 || term.length > 120 || seen.has(term)) return;
      seen.add(term);
      terms.push(term);
    };

    if (normalized.length <= 80) add(normalized);

    const tokens = normalized.match(/[\p{L}\p{N}_./:#-]+/gu) ?? [];
    for (const token of tokens) {
      add(token);
      token
        .split(/[./:#_-]+/)
        .filter((part) => part.length >= 2)
        .forEach(add);
    }

    const hanRuns = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
    for (const run of hanRuns) {
      add(run);
      for (const size of [4, 3, 2]) {
        if (run.length < size) continue;
        for (let index = 0; index <= run.length - size; index += 1) {
          add(run.slice(index, index + size));
          if (terms.length >= 32) return terms;
        }
      }
    }

    return terms.slice(0, 32);
  }

  private lexicalWeight(term: string): number {
    const length = [...term].length;
    if (length >= 12) return 8;
    if (length >= 8) return 6;
    if (length >= 4) return 4;
    return 2;
  }

  private normalizeQuery(value: unknown): string {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  }

  private clampInteger(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }

  private resolveMinVectorSimilarity(): number {
    const configured = Number(
      process.env.KNOWLEDGE_MIN_VECTOR_SIMILARITY ?? 0.3,
    );
    if (!Number.isFinite(configured)) return 0.3;
    return Math.max(-1, Math.min(1, configured));
  }
}
