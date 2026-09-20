                                                

import { Injectable, Logger } from '@nestjs/common';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import { URL } from 'node:url';
import type { WebReadCtx, WebReadInput, WebReadResult } from './webread.types';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_CHARS = 18_000;
const MAX_REDIRECTS = 3;

@Injectable()
export class WebReadProvider {
  private readonly logger = new Logger(WebReadProvider.name);

  async read(input: WebReadInput, ctx: WebReadCtx): Promise<WebReadResult> {
    const startedAt = Date.now();
    const url = this.normalizeUrl(input.url);
    const maxChars = this.clampInt(input.maxChars, 1_000, 40_000, DEFAULT_MAX_CHARS);

    await this.assertPublicHttpUrl(url);

    this.logger.log(
      `[WebRead][start] url=${url.toString()} userId=${ctx.userId} conv=${ctx.conversationId} req=${ctx.requestId ?? '-'} trace=${ctx.traceId ?? '-'}`,
    );

    const fetched = await this.fetchWithRedirects(url, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxBytes: DEFAULT_MAX_BYTES,
      redirectCount: 0,
    });

    const contentType = fetched.contentType ?? '';
    const text = this.decodeBuffer(fetched.body);

    const parsed = this.parseContent({
      url: fetched.finalUrl,
      contentType,
      rawText: text,
      maxChars,
    });

    const durationMs = Date.now() - startedAt;

    this.logger.log(
      `[WebRead][done] url=${url.toString()} finalUrl=${fetched.finalUrl.toString()} status=${fetched.statusCode} contentType=${contentType || '-'} textLen=${parsed.text.length} truncated=${parsed.truncated} durationMs=${durationMs}`,
    );

    this.logger.debug(
      `[WebRead][result_preview] url=${url.toString()} finalUrl=${fetched.finalUrl.toString()} title=${this.cleanLogValue(
        parsed.title,
      )} description=${this.cleanLogValue(parsed.description)} textLen=${
        parsed.text.length
      } excerpt=${this.clip(parsed.text, 800)} links=${parsed.links.length}`,
    );

    return {
      provider: 'webread',
      url: url.toString(),
      finalUrl: fetched.finalUrl.toString(),
      title: parsed.title,
      description: parsed.description,
      text: parsed.text,
      excerpt: this.clip(parsed.text, 1_200),
      links: parsed.links.slice(0, 50),
      meta: {
        statusCode: fetched.statusCode,
        contentType: contentType || null,
        contentLength: fetched.contentLength,
        fetchedAt: new Date().toISOString(),
        durationMs,
        truncated: parsed.truncated,
      },
    };
  }

  private async fetchWithRedirects(
    url: URL,
    options: {
      timeoutMs: number;
      maxBytes: number;
      redirectCount: number;
    },
  ): Promise<{
    finalUrl: URL;
    statusCode: number;
    contentType: string | null;
    contentLength: number | null;
    body: Buffer;
  }> {
    await this.assertPublicHttpUrl(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent':
            'Seekmore-SystemRuntime-WebRead/1.0 (+https://seekmore.local; runtime evidence fetcher)',
          accept:
            'text/html,application/xhtml+xml,text/plain,text/markdown,application/json;q=0.8,*/*;q=0.1',
        },
      });

      const location = response.headers.get('location');
      if (this.isRedirect(response.status) && location) {
        if (options.redirectCount >= MAX_REDIRECTS) {
          throw new Error('Too many redirects while reading URL');
        }

        const nextUrl = new URL(location, url);
        await this.assertPublicHttpUrl(nextUrl);

        return this.fetchWithRedirects(nextUrl, {
          ...options,
          redirectCount: options.redirectCount + 1,
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while reading URL`);
      }

      const contentType = response.headers.get('content-type');
      const contentLength = this.parseContentLength(response.headers.get('content-length'));

      if (contentLength !== null && contentLength > options.maxBytes) {
        throw new Error(`Response too large: ${contentLength} bytes`);
      }

      const body = await this.readLimitedBody(response, options.maxBytes);

      return {
        finalUrl: url,
        statusCode: response.status,
        contentType,
        contentLength,
        body,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
    if (!response.body) {
      return Buffer.from(await response.arrayBuffer());
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const item = await reader.read();
      if (item.done) break;

      total += item.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response body exceeds ${maxBytes} bytes`);
      }

      chunks.push(item.value);
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  private parseContent(input: {
    url: URL;
    contentType: string;
    rawText: string;
    maxChars: number;
  }): {
    title: string | null;
    description: string | null;
    text: string;
    links: Array<{ text?: string | null; url: string }>;
    truncated: boolean;
  } {
    const contentType = input.contentType.toLowerCase();

    if (
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml+xml') ||
      this.looksLikeHtml(input.rawText)
    ) {
      return this.parseHtml(input.url, input.rawText, input.maxChars);
    }

    if (
      contentType.includes('text/') ||
      contentType.includes('application/json') ||
      contentType.includes('application/xml') ||
      contentType.includes('application/javascript')
    ) {
      const normalized = this.normalizeWhitespace(input.rawText);
      const clipped = this.clip(normalized, input.maxChars);
      return {
        title: null,
        description: null,
        text: clipped,
        links: [],
        truncated: normalized.length > clipped.length,
      };
    }

    throw new Error(`Unsupported content type: ${input.contentType || 'unknown'}`);
  }

  private parseHtml(
    baseUrl: URL,
    html: string,
    maxChars: number,
  ): {
    title: string | null;
    description: string | null;
    text: string;
    links: Array<{ text?: string | null; url: string }>;
    truncated: boolean;
  } {
    const title = this.extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description =
      this.extractMeta(html, 'description') ||
      this.extractMeta(html, 'og:description') ||
      this.extractMeta(html, 'twitter:description');

    const links = this.extractLinks(baseUrl, html);

    const body = this.extractBody(html);
    const cleaned = this.htmlToText(body);
    const clipped = this.clip(cleaned, maxChars);

    return {
      title: title ? this.decodeHtmlEntities(this.normalizeWhitespace(title)) : null,
      description: description ? this.decodeHtmlEntities(this.normalizeWhitespace(description)) : null,
      text: clipped,
      links,
      truncated: cleaned.length > clipped.length,
    };
  }

  private htmlToText(html: string): string {
    let text = html;

    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
    text = text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
    text = text.replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, ' ');
    text = text.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ');
    text = text.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');
    text = text.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ');
    text = text.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, ' ');

    text = text.replace(/<(br|hr)\b[^>]*>/gi, '\n');
    text = text.replace(/<\/(p|div|section|article|main|li|h1|h2|h3|h4|h5|h6|tr)>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' ');

    return this.normalizeWhitespace(this.decodeHtmlEntities(text));
  }

  private extractBody(html: string): string {
    const article = this.extractFirstMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i);
    if (article && this.htmlToText(article).length > 500) return article;

    const main = this.extractFirstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if (main && this.htmlToText(main).length > 500) return main;

    return this.extractFirstMatch(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i) || html;
  }

  private extractMeta(html: string, name: string): string | null {
    const escaped = this.escapeRegExp(name);

    const byName = new RegExp(
      `<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      'i',
    );
    const byProperty = new RegExp(
      `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      'i',
    );
    const reversedName = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["'][^>]*>`,
      'i',
    );
    const reversedProperty = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["'][^>]*>`,
      'i',
    );

    return (
      this.extractFirstMatch(html, byName) ||
      this.extractFirstMatch(html, byProperty) ||
      this.extractFirstMatch(html, reversedName) ||
      this.extractFirstMatch(html, reversedProperty)
    );
  }

  private extractLinks(baseUrl: URL, html: string): Array<{ text?: string | null; url: string }> {
    const links: Array<{ text?: string | null; url: string }> = [];
    const seen = new Set<string>();
    const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const href = String(match[1] ?? '').trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
        continue;
      }

      try {
        const resolved = new URL(href, baseUrl).toString();
        if (seen.has(resolved)) continue;

        seen.add(resolved);
        links.push({
          url: resolved,
          text: this.clip(this.htmlToText(match[2] ?? ''), 160) || null,
        });

        if (links.length >= 80) break;
      } catch {
        continue;
      }
    }

    return links;
  }

  private async assertPublicHttpUrl(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only http/https URLs are supported');
    }

    if (!url.hostname) {
      throw new Error('URL hostname is required');
    }

    const hostname = url.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname === 'localhost.localdomain' ||
      hostname.endsWith('.localhost')
    ) {
      throw new Error('Localhost URLs are not allowed');
    }

    if (net.isIP(hostname)) {
      if (this.isPrivateIp(hostname)) {
        throw new Error('Private network URLs are not allowed');
      }
      return;
    }

    const records = await dns.lookup(hostname, { all: true, verbatim: false }).catch(() => []);
    if (!records.length) {
      throw new Error(`Unable to resolve hostname: ${hostname}`);
    }

    for (const record of records) {
      if (this.isPrivateIp(record.address)) {
        throw new Error('Private network resolved address is not allowed');
      }
    }
  }

  private isPrivateIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map((part) => Number(part));

      const [a, b] = parts;

      return (
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 0
      );
    }

    if (net.isIPv6(ip)) {
      const value = ip.toLowerCase();

      return (
        value === '::1' ||
        value.startsWith('fc') ||
        value.startsWith('fd') ||
        value.startsWith('fe80:') ||
        value === '::'
      );
    }

    return true;
  }

  private normalizeUrl(value: unknown): URL {
    const text = String(value ?? '').trim();
    if (!text) throw new Error('Missing "url"');

    try {
      return new URL(text);
    } catch {
      throw new Error('Invalid URL');
    }
  }

  private decodeBuffer(buffer: Buffer): string {
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  }

  private parseContentLength(value: string | null): number | null {
    if (!value) return null;

    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;

    return Math.trunc(n);
  }

  private isRedirect(status: number): boolean {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
  }

  private looksLikeHtml(text: string): boolean {
    const head = text.slice(0, 500).toLowerCase();
    return head.includes('<!doctype html') || head.includes('<html') || head.includes('<body');
  }

  private extractFirstMatch(text: string, pattern: RegExp): string | null {
    const match = pattern.exec(text);
    return match?.[1] ? String(match[1]).trim() : null;
  }

  private decodeHtmlEntities(value: string): string {
    return value
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#(\d+);/g, (_, code) => {
        const n = Number(code);
        return Number.isFinite(n) ? String.fromCodePoint(n) : _;
      })
      .replace(/&#x([a-f0-9]+);/gi, (_, code) => {
        const n = Number.parseInt(code, 16);
        return Number.isFinite(n) ? String.fromCodePoint(n) : _;
      });
  }

  private normalizeWhitespace(value: string): string {
    return String(value ?? '')
      .replace(/\r/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private clip(value: string, maxChars: number): string {
    const text = String(value ?? '').trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…`;
  }

  private cleanLogValue(value: unknown): string {
    const text = String(value ?? '').trim();
    return text ? this.clip(text, 240) : '-';
  }

  private clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.trunc(n), min), max);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}