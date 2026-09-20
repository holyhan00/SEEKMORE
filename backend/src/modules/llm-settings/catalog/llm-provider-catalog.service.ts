                                                                           
import { Injectable } from '@nestjs/common';
import { LLM_PROVIDER_CATALOG } from './llm-provider.catalog';
import type {
  LlmCatalogModel,
  LlmCatalogProvider,
  LlmModelRole,
} from '../contracts/llm-settings.types';

@Injectable()
export class LlmProviderCatalogService {
  private readonly providers: readonly LlmCatalogProvider[];

  constructor() {
    this.providers = [...LLM_PROVIDER_CATALOG]
      .filter((provider) => provider.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const provider of this.providers) this.assertProvider(provider);
  }

  list(): readonly LlmCatalogProvider[] {
    return this.providers;
  }

  provider(providerKey: string): LlmCatalogProvider | null {
    return this.providers.find((provider) => provider.providerKey === providerKey) ?? null;
  }

  model(
    providerKey: string,
    modelKey: string,
  ): { provider: LlmCatalogProvider; model: LlmCatalogModel } | null {
    const provider = this.provider(providerKey);
    const model = provider?.models.find((item) => item.modelKey === modelKey && item.enabled);
    return provider && model ? { provider, model } : null;
  }

  modelForRole(
    providerKey: string,
    modelKey: string,
    role: LlmModelRole,
  ): { provider: LlmCatalogProvider; model: LlmCatalogModel } | null {
    const selected = this.model(providerKey, modelKey);
    return selected?.model.roles.includes(role) ? selected : null;
  }

  findModel(modelKey: string): { provider: LlmCatalogProvider; model: LlmCatalogModel } | null {
    for (const provider of this.providers) {
      const model = provider.models.find((item) => item.modelKey === modelKey && item.enabled);
      if (model) return { provider, model };
    }
    return null;
  }

  protocol(
    provider: LlmCatalogProvider,
    model: LlmCatalogModel,
  ) {
    return model.protocol ?? provider.protocol;
  }

  private assertProvider(provider: LlmCatalogProvider): void {
    for (const [field, value] of [
      ['baseUrl', provider.baseUrl],
      ['apiKeyUrl', provider.apiKeyUrl],
      ['docsUrl', provider.docsUrl],
    ] as const) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(`LLM_PROVIDER_CATALOG_INVALID_${field.toUpperCase()}:${provider.providerKey}`);
      }
    }
    for (const model of provider.models) {
      if (!model.baseUrl) continue;
      const url = new URL(model.baseUrl);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(`LLM_PROVIDER_CATALOG_INVALID_MODEL_BASE_URL:${provider.providerKey}:${model.modelKey}`);
      }
    }
    if (!provider.models.some((model) => model.enabled)) {
      throw new Error(`LLM_PROVIDER_CATALOG_EMPTY:${provider.providerKey}`);
    }
  }
}
