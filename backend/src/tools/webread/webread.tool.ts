                                            

import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { WebReadProvider } from './webread.provider';

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

@Injectable()
export class WebReadTool implements Tool {
  name = 'web.read';
  version = '1.0.0';
  description = 'Read a specific public HTTP/HTTPS URL and return cleaned page text with metadata.';
  tags = ['web', 'read', 'url'];
  timeoutMs = 15_000;

  constructor(private readonly provider: WebReadProvider) {}

  validateArgs = (args: Dict) => {
    const url = String(args?.url ?? '').trim();
    if (!url) throw new Error('Missing "url"');

    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http/https URLs are supported');
    }
  };

  async execute(args: Dict, ctx: ToolContext, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Operation canceled');

    const url = String(args?.url ?? '').trim();
    const userText = String(args?.userText ?? '').trim();
    const maxChars = clampInt(args?.maxChars, 1_000, 40_000, 18_000);

    const result = await this.provider.read(
      {
        url,
        userText,
        maxChars,
      },
      {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        requestId: ctx.requestId,
        traceId: ctx.traceId,
      },
    );

    return {
      ...result,
      citations: [
        {
          title: result.title ?? null,
          url: result.finalUrl || result.url,
          snippet:
            result.description
            ?? result.excerpt
            ?? null,
        },
      ],
    };
  }
}