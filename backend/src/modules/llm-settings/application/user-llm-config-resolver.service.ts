import { Injectable } from '@nestjs/common';
import { AudioGenerationProviderCatalogService } from '../catalog/audio-generation-provider-catalog.service';
import { LlmProviderCatalogService } from '../catalog/llm-provider-catalog.service';
import type {
  LlmModelRole,
  OptionalResolvedModel,
  ResolvedAudioGenerationConfig,
  ResolvedUserLlmConfig,
} from '../contracts/llm-settings.types';
import { UserLlmSettingsRepository } from '../persistence/user-llm-settings.repository';

const MODEL_SELECTION_SEPARATOR = '::';

@Injectable()
export class UserLlmConfigResolverService {
  constructor(
    private readonly repository: UserLlmSettingsRepository,
    private readonly catalog: LlmProviderCatalogService,
    private readonly audioCatalog: AudioGenerationProviderCatalogService,
  ) {}

  async resolve(input: {
    userId: string;
    requestedModelKey?: string | null;
  }): Promise<ResolvedUserLlmConfig> {
    const userId = String(input.userId ?? '').trim();
    if (!userId) throw new Error('USER_LLM_SETTINGS_REQUIRED');

    const preference = await this.repository.preference(userId);
    if (!preference?.providerKey || !preference.modelKey) {
      throw new Error('USER_LLM_SETTINGS_REQUIRED');
    }

    const requested = this.parseRequestedSelection(
      input.requestedModelKey,
      preference.providerKey,
      preference.modelKey,
    );
    return this.resolveSelected(userId, requested.providerKey, requested.modelKey, 'primary');
  }

  async resolveRole(
    userId: string,
    role: Exclude<LlmModelRole, 'primary'>,
  ): Promise<ResolvedUserLlmConfig> {
    const preference = await this.repository.preference(String(userId ?? '').trim());
    if (!preference) throw new Error('USER_LLM_SETTINGS_REQUIRED');

    const providerKey = role === 'vision'
      ? preference.visionProviderKey
      : preference.imageProviderKey;
    const modelKey = role === 'vision'
      ? preference.visionModelKey
      : preference.imageModelKey;

    if (!providerKey || !modelKey) {
      throw new Error(role === 'vision'
        ? 'VISION_MODEL_NOT_CONFIGURED'
        : 'IMAGE_MODEL_NOT_CONFIGURED');
    }
    return this.resolveSelected(userId, providerKey, modelKey, role);
  }

  async resolveOptionalRole(
    userId: string,
    role: Exclude<LlmModelRole, 'primary'>,
  ): Promise<OptionalResolvedModel> {
    try {
      return { configured: true, config: await this.resolveRole(userId, role), reasonCode: null };
    } catch (error) {
      return {
        configured: false,
        config: null,
        reasonCode: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async resolveAudioProvider(
    userId: string,
    providerKey: string,
  ): Promise<ResolvedAudioGenerationConfig> {
    const normalizedUserId = String(userId ?? '').trim();
    const normalizedProviderKey = String(providerKey ?? '').trim();
    if (!normalizedUserId) throw new Error('USER_LLM_SETTINGS_REQUIRED');
    if (!normalizedProviderKey) throw new Error('AUDIO_GENERATION_PROVIDER_NOT_CONFIGURED');
    const provider = this.audioCatalog.provider(normalizedProviderKey);
    if (!provider) throw new Error('AUDIO_GENERATION_PROVIDER_NOT_FOUND');
    const credential = await this.repository.credential(normalizedUserId, normalizedProviderKey);
    const apiKey = String(credential?.apiKey ?? '').trim();
    if (!apiKey) throw new Error('LLM_API_KEY_REQUIRED');
    return {
      providerKey: normalizedProviderKey,
      provider,
      baseUrl: provider.baseUrl,
      apiKey,
      speechModelKey: provider.speechModelKey,
      musicModelKey: provider.musicModelKey,
    };
  }

  async resolveAudioGeneration(userId: string): Promise<ResolvedAudioGenerationConfig> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) throw new Error('USER_LLM_SETTINGS_REQUIRED');
    const preference = await this.repository.preference(normalizedUserId);
    const providerKey = String(preference?.audioProviderKey ?? '').trim();
    if (!providerKey) throw new Error('AUDIO_GENERATION_PROVIDER_NOT_CONFIGURED');
    return this.resolveAudioProvider(normalizedUserId, providerKey);
  }


  private async resolveSelected(
    userId: string,
    providerKey: string,
    modelKey: string,
    role: LlmModelRole,
  ): Promise<ResolvedUserLlmConfig> {
    const selected = this.catalog.modelForRole(providerKey, modelKey, role);
    if (!selected) throw new Error('LLM_MODEL_NOT_FOUND');

    const credential = await this.repository.credential(userId, selected.provider.providerKey);
    if (!credential) throw new Error('LLM_API_KEY_REQUIRED');
    const apiKey = String(credential.apiKey ?? '').trim();
    if (!apiKey) throw new Error('LLM_API_KEY_REQUIRED');

    const capabilities = selected.model.capabilities;
    const protocol = this.catalog.protocol(selected.provider, selected.model);
    return {
      provider: this.runtimeProvider(selected.provider.providerKey, protocol),
      providerKey: selected.provider.providerKey,
      model: selected.model.modelKey,
      baseUrl: selected.model.baseUrl ?? selected.provider.baseUrl,
      apiKey,
      apiMode: selected.model.apiMode,
      protocol,
      capabilities,
      supportsTools: capabilities.toolCalling,
      supportsReasoning: capabilities.reasoning,
      supportsTemperature: capabilities.temperature,
    };
  }

  private parseRequestedSelection(
    requestedModelKey: string | null | undefined,
    preferredProviderKey: string,
    preferredModelKey: string,
  ): { providerKey: string; modelKey: string } {
    const requested = String(requestedModelKey ?? '').trim();
    if (!requested) return { providerKey: preferredProviderKey, modelKey: preferredModelKey };
    const separatorIndex = requested.indexOf(MODEL_SELECTION_SEPARATOR);
    if (separatorIndex < 0) return { providerKey: preferredProviderKey, modelKey: requested };
    const providerKey = requested.slice(0, separatorIndex).trim();
    const modelKey = requested.slice(separatorIndex + MODEL_SELECTION_SEPARATOR.length).trim();
    return { providerKey: providerKey || preferredProviderKey, modelKey };
  }

  private runtimeProvider(providerKey: string, protocol: string): string {
    if (protocol === 'anthropic_messages') return 'anthropic';
    if (['gemini_generate_content', 'gemini_image', 'gemini_interactions_image'].includes(protocol)) return 'gemini';
    return providerKey;
  }
}
