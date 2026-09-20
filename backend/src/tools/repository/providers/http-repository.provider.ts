                                                                     

import type { RepositoryLocator } from '../repository-url-resolver';
import type { RepositoryInspectOutput, RepositoryProvider } from './repository-provider.types';

export class HttpRepositoryProvider implements RepositoryProvider {
  readonly id = 'default';

  canHandle(locator: RepositoryLocator): boolean {
    return Boolean(locator.owner && locator.repo);
  }

  async inspect(locator: RepositoryLocator, signal?: AbortSignal): Promise<RepositoryInspectOutput> {
    const request = this.requestLocator(locator);
    const repoJson = await this.fetchJson(request.metadataUrl, signal);
    const defaultRef = this.text(repoJson.default_branch) ?? locator.ref ?? 'main';
    const readme = await this.fetchText(request.readmeUrl(locator.owner, locator.repo), signal).catch(() => '');
    const htmlUrl = this.text(repoJson.html_url) ?? request.htmlUrl(locator.owner, locator.repo);
    const fullName = this.text(repoJson.full_name) ?? `${locator.owner}/${locator.repo}`;
    const description = this.text(repoJson.description);

    return {
      provider: 'repository',
      sourceProvider: request.providerId,
      locator: {
        owner: locator.owner,
        repo: locator.repo,
        ref: defaultRef,
        url: htmlUrl,
      },
      title: fullName,
      description,
      readme,
      text: [
        `Repository: ${fullName}`,
        description ? `Description: ${description}` : null,
        `Default branch: ${defaultRef}`,
        this.statLine('Stars', repoJson.stargazers_count),
        this.statLine('Forks', repoJson.forks_count),
        this.statLine('Open issues', repoJson.open_issues_count),
        '',
        readme,
      ].filter((item): item is string => Boolean(item)).join('\n'),
      stats: {
        stars: repoJson.stargazers_count ?? null,
        forks: repoJson.forks_count ?? null,
        openIssues: repoJson.open_issues_count ?? null,
        defaultRef,
        license: repoJson.license ?? null,
      },
      citations: [
        {
          title: fullName,
          url: htmlUrl,
          snippet: description?.slice(0, 240) ?? null,
          source: 'repository',
        },
      ],
      meta: {
        fetchedAt: new Date().toISOString(),
        provider: request.providerId,
      },
    };
  }


  async listTree(locator: RepositoryLocator, input: { path?: string | null; ref?: string | null }, signal?: AbortSignal): Promise<import('./repository-provider.types').RepositoryTreeOutput> {
    const request = this.requestLocator(locator);
    const ref = input.ref || locator.ref || await this.defaultRef(locator, signal);
    const path = String(input.path ?? locator.path ?? '').trim();
    const treeUrl = request.treeUrl(locator.owner, locator.repo, ref);
    const json = await this.fetchJson(treeUrl, signal) as { tree?: Array<{ path?: unknown; type?: unknown; size?: unknown; url?: unknown }>; truncated?: unknown };
    const files = (json.tree ?? [])
      .map((item) => ({
        path: String(item.path ?? '').trim(),
        type: String(item.type ?? '').trim(),
        size: typeof item.size === 'number' ? item.size : null,
        url: String(item.url ?? '').trim() || null,
      }))
      .filter((item) => item.path)
      .filter((item) => !path || item.path === path || item.path.startsWith(`${path}/`))
      .slice(0, 500);
    const htmlUrl = request.htmlUrl(locator.owner, locator.repo);
    return {
      provider: 'repository',
      sourceProvider: request.providerId,
      owner: locator.owner,
      repo: locator.repo,
      path,
      ref,
      url: treeUrl,
      htmlUrl,
      truncated: Boolean(json.truncated),
      files,
      text: files.map((item) => `${item.type}\t${item.path}`).join('\n'),
      citations: [{ title: `${locator.owner}/${locator.repo} repository tree`, url: htmlUrl, snippet: `${files.length} repository entries listed.`, source: 'repository' }],
      meta: { fetchedAt: new Date().toISOString(), provider: request.providerId, fileCount: files.length },
    };
  }

  async readFile(locator: RepositoryLocator, input: { path?: string | null; ref?: string | null }, signal?: AbortSignal): Promise<import('./repository-provider.types').RepositoryFileOutput> {
    const request = this.requestLocator(locator);
    const ref = input.ref || locator.ref || 'main';
    const path = String(input.path ?? locator.path ?? '').trim();
    if (!path) throw new Error('Repository file path is required.');
    const fileUrl = request.rawFileUrl(locator.owner, locator.repo, ref, path);
    const text = await this.fetchText(fileUrl, signal);
    const htmlUrl = request.fileHtmlUrl(locator.owner, locator.repo, ref, path);
    return {
      provider: 'repository',
      sourceProvider: request.providerId,
      owner: locator.owner,
      repo: locator.repo,
      path,
      ref,
      url: fileUrl,
      htmlUrl,
      content: text,
      text,
      citations: [{ title: `${locator.owner}/${locator.repo}/${path}`, url: htmlUrl, snippet: text.slice(0, 240), source: 'repository' }],
      meta: { fetchedAt: new Date().toISOString(), provider: request.providerId },
    };
  }

  private async defaultRef(locator: RepositoryLocator, signal?: AbortSignal): Promise<string> {
    const request = this.requestLocator(locator);
    const json = await this.fetchJson(request.metadataUrl, signal).catch(() => ({}));
    return this.text((json as Record<string, unknown>).default_branch) ?? 'main';
  }

  private requestLocator(locator: RepositoryLocator): {
    providerId: string;
    metadataUrl: string;
    htmlUrl: (owner: string, repo: string) => string;
    readmeUrl: (owner: string, repo: string) => string;
    treeUrl: (owner: string, repo: string, ref: string) => string;
    rawFileUrl: (owner: string, repo: string, ref: string, path: string) => string;
    fileHtmlUrl: (owner: string, repo: string, ref: string, path: string) => string;
  } {
    const providerId = locator.provider === 'default' ? 'git' : locator.provider;
    return {
      providerId,
      metadataUrl: `https://api.github.com/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`,
      htmlUrl: (owner, repo) => `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      readmeUrl: (owner, repo) => `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
      treeUrl: (owner, repo, ref) => `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      rawFileUrl: (owner, repo, ref, path) => `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`,
      fileHtmlUrl: (owner, repo, ref, path) => `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(ref)}/${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`,
    };
  }

  private async fetchJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RepositoryRuntime',
      },
    });
    if (!res.ok) throw new Error(`Repository metadata request failed: HTTP ${res.status}`);
    const json = await res.json();
    return json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : {};
  }

  private async fetchText(url: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/vnd.github.raw',
        'User-Agent': 'RepositoryRuntime',
      },
    });
    if (!res.ok) return '';
    return res.text();
  }

  private statLine(label: string, value: unknown): string | null {
    const text = this.text(value);
    return text ? `${label}: ${text}` : null;
  }

  private text(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }
}
