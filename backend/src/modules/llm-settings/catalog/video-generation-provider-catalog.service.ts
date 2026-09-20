import { Injectable } from '@nestjs/common';
import {
  VIDEO_GENERATION_PROVIDER_CATALOG,
} from '../../media-ai/video/video-provider.catalog';
import type {
  VideoGenerationProviderDefinition,
} from '../../media-ai/video/video-generation.types';

@Injectable()
export class VideoGenerationProviderCatalogService {
  private readonly providers = new Map<string, VideoGenerationProviderDefinition>(
    VIDEO_GENERATION_PROVIDER_CATALOG.map((provider) => [provider.providerKey, provider]),
  );

  list() {
    return [...VIDEO_GENERATION_PROVIDER_CATALOG]
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((model) => model.enabled),
      }))
      .filter((provider) => provider.models.length > 0)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  provider(providerKey: string) {
    const provider = this.providers.get(String(providerKey ?? '').trim());
    return provider?.enabled ? provider : null;
  }

  model(providerKey: string, modelKey: string) {
    const provider = this.provider(providerKey);
    if (!provider) return null;
    const model = provider.models.find(
      (item) => item.enabled && item.modelKey === String(modelKey ?? '').trim(),
    );
    return model ? { provider, model } : null;
  }
}
