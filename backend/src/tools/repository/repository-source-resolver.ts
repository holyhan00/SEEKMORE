                                                             

import type { RepositoryLocator } from './repository-url-resolver';
import { RepositoryUrlResolver } from './repository-url-resolver';
import { HttpRepositoryProvider } from './providers/http-repository.provider';
import type { RepositoryProvider } from './providers/repository-provider.types';

export class RepositorySourceResolver {
  private readonly urlResolver = new RepositoryUrlResolver();
  private readonly providers: RepositoryProvider[];

  constructor(providers?: RepositoryProvider[]) {
    this.providers = providers?.length ? providers : [new HttpRepositoryProvider()];
  }

  resolve(input: { url?: unknown; owner?: unknown; repo?: unknown; ref?: unknown }): {
    locator: RepositoryLocator;
    provider: RepositoryProvider;
  } {
    const locator = this.resolveLocator(input);
    const provider = this.providers.find((item) => item.canHandle(locator));
    if (!provider) throw new Error('No repository provider can handle the supplied locator.');
    return { locator, provider };
  }

  private resolveLocator(input: { url?: unknown; owner?: unknown; repo?: unknown; ref?: unknown }): RepositoryLocator {
    const parsed = this.urlResolver.parse(input.url);
    if (parsed) return { ...parsed, ref: parsed.ref ?? this.text(input.ref) };

    const owner = this.text(input.owner);
    const repo = this.text(input.repo)?.replace(/\.git$/i, '');
    if (!owner || !repo) throw new Error('Repository source requires a URL or owner/repository locator.');

    return {
      provider: 'default',
      owner,
      repo,
      ref: this.text(input.ref),
      url: null,
    };
  }

  private text(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }
}
