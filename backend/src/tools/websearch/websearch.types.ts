
                                                 

export type WebSearchQuery = {
  q: string;
  num?: number;              
  language?: string;                        
  region?: string;                                              
  categories?: string;                        
  safesearch?: 0 | 1 | 2;
};

export type WebSearchHit = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  score?: number;
};

export type WebSearchResult = {
  hits: WebSearchHit[];
  meta?: Record<string, any>;
};