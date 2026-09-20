import type { ResolvedWebSearchConfig } from '../../modules/web-search-settings/contracts/web-search-settings.types';
import type { WebSearchQuery, WebSearchResult } from './websearch.types';

export type WebSearchCtx = {
  userId: string;
  conversationId: string;
  requestId?: string;
  traceId?: string;
};

export interface WebSearchProvider {
  readonly name: string;
  supports(config: ResolvedWebSearchConfig): boolean;
  search(
    input: WebSearchQuery,
    ctx: WebSearchCtx,
    config: ResolvedWebSearchConfig,
  ): Promise<WebSearchResult>;
}
