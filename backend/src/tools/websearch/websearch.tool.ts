import { Injectable } from '@nestjs/common';
import { WebSearchSettingsService } from '../../modules/web-search-settings/application/web-search-settings.service';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { WebSearchProviderRegistry } from './websearch-provider.registry';
import { normalizeLanguageTag } from '../../modules/localization/locale-normalizer';

function clampInt(n: unknown, min: number, max: number, def: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return def;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

@Injectable()
export class WebSearchTool implements Tool {
  name = 'web.search';
  version = '2.0.0';
  description = 'Search the public web using the user-configured search provider.';
  tags = ['web', 'search'];
  timeoutMs = 45_000;
  providerKind = 'web' as const;
  capabilityKinds = ['web.search'];

  constructor(
    private readonly settings: WebSearchSettingsService,
    private readonly providers: WebSearchProviderRegistry,
  ) {}

  validateArgs = (args: Dict) => {
    const q = String(args?.q ?? args?.query ?? '').trim();
    if (!q) throw new Error('Missing "q" (search query)');
    const num = clampInt(args?.num ?? args?.topK ?? 5, 1, 10, 5);
    if (!Number.isFinite(num) || num < 1) throw new Error('"num" must be >= 1');
  };

  canExecute = async (ctx: ToolContext) => Boolean(
    await this.settings.resolveOptional(ctx.userId),
  );

  async execute(args: Dict, ctx: ToolContext, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Operation canceled');
    const config = await this.settings.resolveOptional(ctx.userId);
    if (!config) throw new Error('WEB_SEARCH_NOT_CONFIGURED');
    const provider = this.providers.resolve(config);

    const q = String(args?.q ?? args?.query ?? '').trim();
    const num = clampInt(args?.num ?? args?.topK ?? 5, 1, 10, 5);
    const language = normalizeLanguageTag(args?.language ?? 'en') ?? 'en';
    const region = String(args?.region ?? '').trim().toUpperCase() || undefined;
    const categories = String(args?.categories ?? 'general').trim() || 'general';
    const safesearch = (args?.safesearch ?? 1) as 0 | 1 | 2;

    const result = await provider.search(
      { q, num, language, region, categories, safesearch },
      {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
      },
      config,
    );

    return {
      provider: provider.name,
      query: q,
      hits: result.hits,
      citations: result.hits.map((hit) => ({
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet ?? null,
      })),
      meta: result.meta ?? {},
    };
  }
}
