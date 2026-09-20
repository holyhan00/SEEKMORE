                                             

export type WebReadInput = {
  url: string;
  userText?: string;
  maxChars?: number;
};

export type WebReadCtx = {
  userId: string;
  conversationId: string;
  requestId?: string;
  traceId?: string;
};

export type WebReadResult = {
  provider: 'webread';
  url: string;
  finalUrl: string;
  title?: string | null;
  description?: string | null;
  text: string;
  excerpt: string;
  links: Array<{
    text?: string | null;
    url: string;
  }>;
  meta: {
    statusCode: number;
    contentType?: string | null;
    contentLength?: number | null;
    fetchedAt: string;
    durationMs: number;
    truncated: boolean;
  };
};