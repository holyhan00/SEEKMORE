import { Injectable } from '@nestjs/common';
import { WebSearchTool } from '../../../../tools/websearch/websearch.tool';
import { WebReadTool } from '../../../../tools/webread/webread.tool';
import type { GrowProfessionalSourceSummary } from '../../domain/grow.types';
import type { GrowProfessionalStudyPort } from '../../ports/grow-professional-study.port';

@Injectable()
export class SeekmoreGrowProfessionalStudyAdapter implements GrowProfessionalStudyPort {
  constructor(
    private readonly webSearch: WebSearchTool,
    private readonly webRead: WebReadTool,
  ) {}

  async study(
    request: Parameters<GrowProfessionalStudyPort['study']>[0],
    scope: Parameters<GrowProfessionalStudyPort['study']>[1],
  ) {
    const context = {
      userId: scope.userId,
      conversationId: scope.conversationId,
      traceId: `grow-study:${scope.reviewId}`,
      requestId: scope.reviewId,
      metadata: { agentId: 'grow', growReviewId: scope.reviewId },
    };
    try {
      const response = await this.webSearch.execute({
        q: `${request.question} official documentation standard repository`,
        num: 5,
        language: 'en',
        safesearch: 1,
      }, context);
      const hits = this.hits(response).slice(0, 4);
      const findings: GrowProfessionalSourceSummary[] = [];
      for (const hit of hits) {
        try {
          const page = await this.webRead.execute({
            url: hit.url,
            userText: request.context,
            maxChars: 12_000,
          }, context);
          const row = page && typeof page === 'object' ? page as Record<string, unknown> : {};
          findings.push({
            sourceType: this.sourceType(hit.url),
            title: String(row.title ?? hit.title ?? hit.url).slice(0, 500),
            publisher: this.publisher(hit.url),
            retrievedAt: new Date().toISOString(),
            summary: this.summary(row, hit.snippet),
            authorityScore: this.authority(hit.url),
            relevanceScore: 0.8,
          });
        } catch {
          findings.push({
            sourceType: this.sourceType(hit.url),
            title: String(hit.title ?? hit.url).slice(0, 500),
            publisher: this.publisher(hit.url),
            retrievedAt: new Date().toISOString(),
            summary: String(hit.snippet ?? '').slice(0, 2000),
            authorityScore: this.authority(hit.url),
            relevanceScore: 0.65,
          });
        }
      }
      return {
        question: request.question,
        findings,
        limitations: findings.length ? [] : ['No readable professional sources were returned by the configured web provider.'],
      };
    } catch (error) {
      return {
        question: request.question,
        findings: [],
        limitations: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private hits(value: unknown): Array<{ title?: string; url: string; snippet?: string }> {
    if (!value || typeof value !== 'object') return [];
    const hits = (value as Record<string, unknown>).hits;
    if (!Array.isArray(hits)) return [];
    return hits.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const url = String(row.url ?? '').trim();
      return url ? [{ title: String(row.title ?? ''), url, snippet: String(row.snippet ?? '') }] : [];
    });
  }

  private sourceType(url: string): GrowProfessionalSourceSummary['sourceType'] {
    const host = this.publisher(url).toLowerCase();
    if (host === 'github.com') return 'OFFICIAL_REPOSITORY';
    if (/ietf\.org|w3\.org|iso\.org|rfc-editor\.org/.test(host)) return 'STANDARD';
    if (/arxiv\.org|doi\.org|acm\.org|ieee\.org/.test(host)) return 'RESEARCH_PAPER';
    return 'OFFICIAL_DOCUMENTATION';
  }

  private authority(url: string): number {
    const type = this.sourceType(url);
    return type === 'STANDARD' ? 0.98 : type === 'OFFICIAL_DOCUMENTATION' || type === 'OFFICIAL_REPOSITORY' ? 0.92 : 0.85;
  }

  private publisher(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  private summary(row: Record<string, unknown>, fallback?: string): string {
    const text = row.text ?? row.content ?? row.excerpt ?? row.description ?? fallback ?? '';
    return String(text).replace(/\s+/g, ' ').trim().slice(0, 5000);
  }
}
