                                                                      
export type WebSearchPublicNotice = {
  kind: 'privacy' | 'security' | 'warning';
  text: string;
  persistent: boolean;
};

export type WebSearchCardHit = {
  evidenceRef?: string | null;
  title: string;
  url: string;
  sourceType?: string | null;
  publishedAt?: string | null;
  score?: number | null;
  summary?: string | null;
};

export type WebSearchCardResult = {
  query?: string | null;
  mode?: string | null;
  safetyNotice?: string | null;
  hits: WebSearchCardHit[];
  diagnostics?: Record<string, unknown> | null;
};
