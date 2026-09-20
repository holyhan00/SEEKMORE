                                                                      

import type { RepositoryLocator } from '../repository-url-resolver';

export type RepositoryInspectOutput = {
  provider: 'repository';
  sourceProvider?: string;
  locator: {
    owner?: string;
    repo?: string;
    ref?: string | null;
    url?: string | null;
  };
  title?: string | null;
  description?: string | null;
  readme?: string | null;
  text: string;
  stats?: Record<string, unknown>;
  citations: RuntimeToolCitationLike[];
  meta: Record<string, unknown>;
};

export interface RepositoryTreeOutput {
  provider: 'repository';
  sourceProvider?: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
  url: string;
  htmlUrl: string;
  truncated: boolean;
  files: Array<{ path: string; type: string; size: number | null; url: string | null }>;
  text: string;
  citations: RuntimeToolCitationLike[];
  meta: Record<string, unknown>;
}

export interface RepositoryFileOutput {
  provider: 'repository';
  sourceProvider?: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
  url: string;
  htmlUrl: string;
  content: string;
  text: string;
  citations: RuntimeToolCitationLike[];
  meta: Record<string, unknown>;
}

export type RuntimeToolCitationLike = {
  title?: string | null;
  url?: string | null;
  snippet?: string | null;
  source?: string | null;
};

export interface RepositoryProvider {
  readonly id: string;
  canHandle(locator: RepositoryLocator): boolean;
  inspect(locator: RepositoryLocator, signal?: AbortSignal): Promise<RepositoryInspectOutput>;
  listTree?(locator: RepositoryLocator, input: { path?: string | null; ref?: string | null }, signal?: AbortSignal): Promise<RepositoryTreeOutput>;
  readFile?(locator: RepositoryLocator, input: { path?: string | null; ref?: string | null }, signal?: AbortSignal): Promise<RepositoryFileOutput>;
}
