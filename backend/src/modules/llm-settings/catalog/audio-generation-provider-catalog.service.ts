import { Injectable } from '@nestjs/common';
import { AUDIO_GENERATION_PROVIDER_CATALOG } from './audio-generation-provider.catalog';

@Injectable()
export class AudioGenerationProviderCatalogService {
  private readonly providers = new Map(
    AUDIO_GENERATION_PROVIDER_CATALOG.map((provider) => [provider.providerKey, provider]),
  );

  list() {
    return [...AUDIO_GENERATION_PROVIDER_CATALOG]
      .filter((provider) => provider.enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  provider(providerKey: string) {
    const provider = this.providers.get(String(providerKey ?? '').trim());
    return provider?.enabled ? provider : null;
  }
}
