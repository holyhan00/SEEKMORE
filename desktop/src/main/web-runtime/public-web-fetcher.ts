import { DesktopWebNetworkPolicy } from './web-network-policy';

export class PublicWebFetcher {
  private readonly policy = new DesktopWebNetworkPolicy();

  async fetch(input: { url: string; timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> }): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    let current = await this.policy.assertAllowed(input.url, 'background');
    const maxRedirects = 5;
    const maxBytes = Math.min(5_000_000, Math.max(64_000, Number(input.maxBytes ?? 2_000_000)));

    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(30_000, Math.max(1_000, Number(input.timeoutMs ?? 10_000))));
      try {
        const response = await fetch(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,text/plain;q=0.7,*/*;q=0.2',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
            'User-Agent': 'Mozilla/5.0 (Seekmore Desktop; local web runtime) AppleWebKit/537.36 Chrome/124 Safari/537.36',
            ...this.safeHeaders(input.headers),
          },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) throw Object.assign(new Error('Redirect response is missing a Location header.'), { code: 'WEB_REDIRECT_INVALID' });
          current = await this.policy.assertAllowed(new URL(location, current).toString(), 'background');
          continue;
        }
        const contentType = response.headers.get('content-type');
        if (!this.isTextContent(contentType)) {
          throw Object.assign(new Error(`Unsupported public page content type: ${contentType ?? 'unknown'}`), { code: 'WEB_CONTENT_TYPE_BLOCKED' });
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (reader) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > maxBytes) throw Object.assign(new Error('Public page response exceeded the configured size limit.'), { code: 'WEB_RESPONSE_TOO_LARGE' });
          chunks.push(next.value);
        }
        const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
        return {
          url: input.url,
          finalUrl: current.toString(),
          statusCode: response.status,
          contentType,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          body: bytes.toString('utf8').replace(/^\uFEFF/, ''),
          sizeBytes: bytes.byteLength,
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    throw Object.assign(new Error('Too many redirects.'), { code: 'WEB_REDIRECT_LIMIT' });
  }

  private safeHeaders(input: Record<string, string> | undefined): Record<string, string> {
    if (!input) return {};
    const allowed = new Set(['accept', 'accept-language', 'cache-control', 'if-none-match', 'if-modified-since', 'user-agent']);
    const blocked = /^(?:authorization|cookie|proxy-authorization|host|origin|referer|sec-|x-forwarded-|x-real-ip)/i;
    return Object.fromEntries(
      Object.entries(input)
        .filter(([key]) => allowed.has(key.toLowerCase()) && !blocked.test(key))
        .map(([key, value]) => [key, String(value).slice(0, 2_000)]),
    );
  }

  private isTextContent(contentType: string | null): boolean {
    if (!contentType) return true;
    return /^(text\/|application\/(?:xhtml\+xml|json|ld\+json|xml))/i.test(contentType.trim());
  }
}
