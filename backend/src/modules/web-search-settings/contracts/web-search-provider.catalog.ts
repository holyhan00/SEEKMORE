import type { WebSearchCatalogProvider } from './web-search-settings.types';

export const WEB_SEARCH_PROVIDER_CATALOG = [
  {
    providerKey: 'serper',
    displayName: 'Serper',
    baseUrl: 'https://google.serper.dev',
    apiKeyUrl: 'https://serper.dev/dashboard',
    docsUrl: 'https://serper.dev/',
    enabled: true,
  },
] as const satisfies readonly WebSearchCatalogProvider[];
