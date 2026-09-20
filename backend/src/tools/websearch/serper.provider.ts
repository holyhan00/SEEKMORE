                                                 

import { Injectable, Logger } from '@nestjs/common';
import type { WebSearchProvider, WebSearchCtx } from './websearch.provider';
import type { ResolvedWebSearchConfig } from '../../modules/web-search-settings/contracts/web-search-settings.types';
import type { WebSearchQuery, WebSearchResult, WebSearchHit } from './websearch.types';

type SerperEndpoint = '/search' | '/news';
type SerperSafeSearch = 'off' | 'medium' | 'active';

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeLanguage(value: unknown): string {
  const raw = String(value ?? 'en').trim().toLowerCase().replace('_', '-');
  return raw || 'en';
}

function normalizeRegion(value: unknown): string | undefined {
  const region = String(value ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(region) ? region : undefined;
}

function pickEndpoint(category: unknown): SerperEndpoint {
  return String(category ?? 'general').trim().toLowerCase() === 'news' ? '/news' : '/search';
}

function toSafeSearch(value: unknown): SerperSafeSearch {
  if (value === 0) return 'off';
  if (value === 2) return 'active';
  return 'medium';
}

function clip(value: string, max = 220): string {
  if (!value) return value;
  return value.length <= max ? value : `${value.slice(0, max)}…<truncated:${value.length - max}>`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

@Injectable()
export class SerperProvider implements WebSearchProvider {
  readonly name = 'serper';
  private readonly logger = new Logger(SerperProvider.name);

  private readonly timeoutMs = 15_000;

  supports(config: ResolvedWebSearchConfig): boolean {
    return config.providerKey === this.name;
  }

  async search(
    input: WebSearchQuery,
    ctx: WebSearchCtx,
    config: ResolvedWebSearchConfig,
  ): Promise<WebSearchResult> {
    const startedAt = Date.now();

    const q = String(input?.q ?? '').trim();
    const num = clampInt(input?.num, 1, 10, 5);
    const hl = normalizeLanguage(input?.language);
    const endpoint = pickEndpoint(input?.categories);
    const gl = normalizeRegion(input?.region);
    const safe = toSafeSearch(input?.safesearch);

    const ctxInfo = this.formatCtx(ctx);

    this.logger.log(
      `[Serper][start] ${ctxInfo} q="${clip(q, 120)}" num=${num} hl=${hl} gl=${gl ?? '-'} endpoint=${endpoint} safe=${safe}`,
    );

    if (!q) {
      this.logger.warn(`[Serper][skip] empty query ${ctxInfo}`);
      return { hits: [], meta: { provider: this.name, empty: true } };
    }

    const primary = await this.request({
      q,
      num,
      hl,
      gl,
      endpoint,
      safe,
      startedAt,
      ctxInfo,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });

    if (primary.hits.length > 0 || endpoint === '/search') {
      return primary;
    }

    this.logger.warn(`[Serper][fallback] endpoint=/news returned empty, retrying endpoint=/search ${ctxInfo}`);

    return this.request({
      q,
      num,
      hl,
      gl,
      endpoint: '/search',
      safe,
      startedAt,
      ctxInfo,
      fallbackFrom: '/news',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
  }

  private async request(input: {
    q: string;
    num: number;
    hl: string;
    gl?: string;
    endpoint: SerperEndpoint;
    safe: SerperSafeSearch;
    startedAt: number;
    ctxInfo: string;
    fallbackFrom?: SerperEndpoint;
    baseUrl: string;
    apiKey: string;
  }): Promise<WebSearchResult> {
    const url = new URL(input.endpoint, input.baseUrl);
    const payload = {
      q: input.q,
      num: input.num,
      hl: input.hl,
      ...(input.gl ? { gl: input.gl } : {}),
      safe: input.safe,
    };

    this.logger.log(
      `[Serper][request] POST ${url.toString()} payload=${clip(safeJson(payload), 350)} ${input.ctxInfo}`,
    );

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs).unref?.();

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'X-API-KEY': input.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });

      const text = await res.text().catch(() => '');

      this.logger.log(
        `[Serper][response] HTTP ${res.status} ok=${res.ok} ${input.ctxInfo} durationMs=${Date.now() - input.startedAt}`,
      );
      this.logger.log(`[Serper][raw] len=${text.length} head=${clip(text, 220)} ${input.ctxInfo}`);

      if (!res.ok) {
        throw new Error(`Serper HTTP ${res.status}: ${clip(text, 200) || res.statusText}`);
      }

      const json = this.parseJson(text);
      const rawItems = this.readItems(json, input.endpoint);
      const hits = rawItems
        .map((item, index) => this.toHit(item, input.endpoint, index))
        .filter((item): item is WebSearchHit => Boolean(item))
        .slice(0, input.num);

      const preview = hits.slice(0, 2).map((hit, index) => ({
        i: index + 1,
        title: clip(hit.title, 80),
        url: clip(hit.url, 120),
      }));

      this.logger.log(
        `[Serper][parsed] endpoint=${input.endpoint} rawItems=${rawItems.length} hits=${hits.length} preview=${safeJson(preview)} ${input.ctxInfo}`,
      );

      return {
        hits,
        meta: {
          provider: this.name,
          endpoint: input.endpoint,
          fallbackFrom: input.fallbackFrom ?? null,
          q: input.q,
          num: input.num,
          hl: input.hl,
          gl: input.gl ?? null,
          safe: input.safe,
          rawCount: rawItems.length,
          durationMs: Date.now() - input.startedAt,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `[Serper][exception] ${error?.message ?? error} ${input.ctxInfo} durationMs=${Date.now() - input.startedAt}`,
        error?.stack,
      );
      throw error;
    } finally {
      clearTimeout(timeout as any);
    }
  }

  private parseJson(text: string): Record<string, unknown> {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Serper response JSON parse failed');
    }
  }

  private readItems(json: Record<string, unknown>, endpoint: SerperEndpoint): unknown[] {
    if (endpoint === '/news') {
      return Array.isArray(json.news) ? json.news : [];
    }

    return Array.isArray(json.organic) ? json.organic : [];
  }

  private toHit(item: unknown, endpoint: SerperEndpoint, index: number): WebSearchHit | null {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

    const record = item as Record<string, unknown>;
    const url = String(record.link ?? record.url ?? '').trim();

    if (!url || !isHttpUrl(url)) return null;

    const title = String(record.title ?? '').trim() || url;
    const snippet = String(record.snippet ?? record.summary ?? '').trim();

    return {
      title,
      url,
      snippet: snippet || undefined,
      source: endpoint === '/news' ? String(record.source ?? 'serper.news') : 'serper.search',
      score: typeof record.position === 'number' ? 1000 - record.position : 1000 - index,
    };
  }

  private formatCtx(ctx: WebSearchCtx): string {
    return `userId=${ctx?.userId ?? '-'} conv=${ctx?.conversationId ?? '-'} req=${ctx?.requestId ?? '-'} trace=${ctx?.traceId ?? '-'}`;
  }
}