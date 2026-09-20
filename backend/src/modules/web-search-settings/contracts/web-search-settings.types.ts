import type { LlmCredentialStatus } from '@prisma/client';

export interface WebSearchCatalogProvider {
  providerKey: string;
  displayName: string;
  baseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
  enabled: boolean;
}

export interface ResolvedWebSearchConfig {
  providerKey: string;
  baseUrl: string;
  apiKey: string;
}

export interface WebSearchValidationResult {
  status: LlmCredentialStatus;
  code: string;
  verifiedAt: Date | null;
}
