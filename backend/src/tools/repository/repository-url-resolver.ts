                                                          

export type RepositoryLocator = {
  provider: string;
  owner: string;
  repo: string;
  path?: string | null;
  ref?: string | null;
  url?: string | null;
};

export class RepositoryUrlResolver {
  parse(value: unknown): RepositoryLocator | null {
    const text = String(value ?? '').trim();
    if (!text) return null;

    const parsedUrl = this.parseUrl(text);
    if (parsedUrl) return parsedUrl;

    const shorthand = this.parseShorthand(text);
    return shorthand;
  }

  private parseUrl(text: string): RepositoryLocator | null {
    try {
      const url = new URL(text);
      const provider = this.providerFromHost(url.hostname);
      if (!provider) return null;

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;

      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/i, '');
      let ref: string | null = null;
      let path: string | null = null;

      if (parts[2] === 'tree' || parts[2] === 'blob') {
        ref = parts[3] ?? null;
        path = parts.slice(4).join('/') || null;
      }

      return { provider, owner, repo, ref, path, url: url.toString() };
    } catch {
      return null;
    }
  }

  private parseShorthand(text: string): RepositoryLocator | null {
    const match = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (!match) return null;
    return {
      provider: 'default',
      owner: match[1],
      repo: match[2].replace(/\.git$/i, ''),
      url: null,
    };
  }

  private providerFromHost(hostname: string): string | null {
    const normalized = hostname.trim().toLowerCase().replace(/^www\./, '');
    if (!normalized) return null;
    return normalized;
  }
}
