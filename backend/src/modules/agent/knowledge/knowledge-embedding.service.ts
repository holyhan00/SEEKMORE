                                                                     

import { Injectable } from '@nestjs/common';

interface EmbeddingResponse {
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
}

@Injectable()
export class KnowledgeEmbeddingService {
  readonly model = String(process.env.EMBEDDING_MODEL || '').trim();
  private readonly baseUrl = String(process.env.EMBEDDING_BASE_URL || '').trim();
  private readonly apiKey = String(process.env.EMBEDDING_API_KEY || '').trim();
  private readonly batchSize = this.resolveBatchSize();

  isEnabled(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.model);
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.isEnabled()) return null;

    const [embedding] = await this.requestEmbeddings([String(text || '')]);
    return embedding ?? null;
  }

  async embedMany(texts: string[]): Promise<Array<number[] | null>> {
    if (!texts.length) return [];
    if (!this.isEnabled()) return texts.map(() => null);

    const output: Array<number[] | null> = [];

    for (let start = 0; start < texts.length; start += this.batchSize) {
      const batch = texts
        .slice(start, start + this.batchSize)
        .map((text) => String(text || ''));
      const embeddings = await this.requestEmbeddings(batch);
      output.push(...embeddings);
    }

    return output;
  }

  toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  private async requestEmbeddings(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: texts.length === 1 ? texts[0] : texts,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const detail = body.trim().slice(0, 500);
      throw new Error(
        `Embedding request failed (${res.status})${detail ? `: ${detail}` : ''}`,
      );
    }

    const json = (await res.json()) as EmbeddingResponse;
    const rows = Array.isArray(json.data) ? json.data : [];

    if (rows.length !== texts.length) {
      throw new Error(
        `Embedding response count mismatch: expected ${texts.length}, received ${rows.length}`,
      );
    }

    const ordered = rows
      .map((row, position) => ({
        index: Number.isInteger(row.index) ? Number(row.index) : position,
        embedding: row.embedding,
      }))
      .sort((a, b) => a.index - b.index);

    const embeddings = ordered.map((row, index) => {
      if (
        !Array.isArray(row.embedding)
        || row.embedding.length === 0
        || row.embedding.some((value) => !Number.isFinite(value))
      ) {
        throw new Error(`Embedding response is invalid at index ${index}`);
      }

      return row.embedding;
    });

    const dimensions = new Set(embeddings.map((embedding) => embedding.length));
    if (dimensions.size !== 1) {
      throw new Error('Embedding response contains inconsistent vector dimensions');
    }

    return embeddings;
  }

  private resolveBatchSize(): number {
    const configured = Number(process.env.EMBEDDING_BATCH_SIZE || 32);
    if (!Number.isFinite(configured)) return 32;
    return Math.max(1, Math.min(128, Math.floor(configured)));
  }
}
