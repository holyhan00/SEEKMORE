import { Injectable } from '@nestjs/common';
import type { ResolvedWebSearchConfig } from '../../modules/web-search-settings/contracts/web-search-settings.types';
import { SerperProvider } from './serper.provider';
import type { WebSearchProvider } from './websearch.provider';

@Injectable()
export class WebSearchProviderRegistry {
  private readonly providers: WebSearchProvider[];

  constructor(serper: SerperProvider) {
    this.providers = [serper];
  }

  resolve(config: ResolvedWebSearchConfig): WebSearchProvider {
    const provider = this.providers.find((item) => item.supports(config));
    if (!provider) throw new Error('WEB_SEARCH_PROVIDER_NOT_FOUND');
    return provider;
  }
}
