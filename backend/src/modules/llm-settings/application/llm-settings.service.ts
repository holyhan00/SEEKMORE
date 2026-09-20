import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AudioGenerationProviderCatalogService } from '../catalog/audio-generation-provider-catalog.service';
import { LlmProviderCatalogService } from '../catalog/llm-provider-catalog.service';
import { VideoGenerationProviderCatalogService } from '../catalog/video-generation-provider-catalog.service';
import type { AiSelectionRole } from '../contracts/llm-settings.types';
import { UserLlmSettingsRepository } from '../persistence/user-llm-settings.repository';
import { AudioGenerationCredentialValidationService } from './audio-generation-credential-validation.service';
import { EffectiveMediaRouteService } from './effective-media-route.service';
import { LlmCredentialValidationService } from './llm-credential-validation.service';
import { VideoGenerationCredentialValidationService } from './video-generation-credential-validation.service';

@Injectable()
export class LlmSettingsService {
  constructor(
    private readonly repository: UserLlmSettingsRepository,
    private readonly catalog: LlmProviderCatalogService,
    private readonly audioCatalog: AudioGenerationProviderCatalogService,
    private readonly videoCatalog: VideoGenerationProviderCatalogService,
    private readonly validator: LlmCredentialValidationService,
    private readonly audioValidator: AudioGenerationCredentialValidationService,
    private readonly videoValidator: VideoGenerationCredentialValidationService,
    private readonly effectiveRoutes: EffectiveMediaRouteService,
  ) {}

  catalogView() {
    return {
      providers: this.catalog.list(),
      videoProviders: this.videoCatalog.list(),
      audioProviders: this.audioCatalog.list(),
    };
  }

  async get(userId: string) {
    const [settings, effectiveMediaRoutes] = await Promise.all([
      this.repository.settings(userId),
      this.effectiveRoutes.get(userId),
    ]);
    return {
      ...this.view(settings),
      effectiveMediaRoutes,
    };
  }

  async save(userId: string, input: {
    role?: AiSelectionRole;
    providerKey: string;
    modelKey?: string;
    apiKey?: string;
  }) {
    const role = input.role ?? 'primary';
    const providerKey = String(input.providerKey ?? '').trim();
    const modelKey = String(input.modelKey ?? '').trim();

    const existing = await this.repository.credential(userId, providerKey);
    const suppliedApiKey = String(input.apiKey ?? '').trim();
    const existingApiKey = String(existing?.apiKey ?? '').trim();
    const apiKey = suppliedApiKey || existingApiKey;
    if (!apiKey) throw new BadRequestException('LLM_API_KEY_REQUIRED');

    let validation;
    if (role === 'audio_generation') {
      const provider = this.audioCatalog.provider(providerKey);
      if (!provider) throw new NotFoundException('AUDIO_GENERATION_PROVIDER_NOT_FOUND');
      validation = await this.audioValidator.validate({ provider, apiKey });
    } else if (role === 'video_generation') {
      if (!modelKey) throw new BadRequestException('VIDEO_GENERATION_MODEL_REQUIRED');
      const selected = this.videoCatalog.model(providerKey, modelKey);
      if (!selected) throw new NotFoundException('VIDEO_GENERATION_MODEL_NOT_FOUND');
      if (!suppliedApiKey && String(existing?.status ?? '').toUpperCase() === 'INVALID') {
        throw new BadRequestException('LLM_API_KEY_REQUIRED');
      }
      validation = !suppliedApiKey && existing
        ? {
            status: existing.status,
            verifiedAt: existing.verifiedAt,
            code: existing.lastValidationCode,
          }
        : await this.videoValidator.validate({ provider: selected.provider, apiKey });
    } else {
      if (!modelKey) throw new BadRequestException('LLM_MODEL_REQUIRED');
      const selected = this.catalog.modelForRole(providerKey, modelKey, role);
      if (!selected) throw new NotFoundException('LLM_MODEL_NOT_FOUND');
      if (role === 'primary' && !selected.model.capabilities.toolCalling) {
        throw new BadRequestException('LLM_MODEL_NOT_AGENT_COMPATIBLE');
      }
      if (role === 'vision' && !selected.model.capabilities.imageInput) {
        throw new BadRequestException('VISION_MODEL_NOT_COMPATIBLE');
      }
      if (role === 'image_generation' && !selected.model.capabilities.imageOutput) {
        throw new BadRequestException('IMAGE_MODEL_NOT_COMPATIBLE');
      }
      validation = await this.validator.validate({ ...selected, apiKey, role });
    }

    if (validation.status === 'INVALID') throw new BadRequestException(validation.code);

    if (!suppliedApiKey && existing) {
      await this.repository.selectRoleWithExistingCredential({
        userId,
        role,
        providerKey,
        modelKey,
      });
      if (role !== 'video_generation') {
        await this.repository.updateValidation({
          userId,
          providerKey,
          status: validation.status,
          verifiedAt: validation.verifiedAt,
          lastValidationCode: validation.code,
        });
      }
    } else {
      await this.repository.saveRole({
        userId,
        role,
        providerKey,
        modelKey,
        apiKey,
        keyHint: this.keyHint(apiKey),
        status: validation.status,
        verifiedAt: validation.verifiedAt,
        lastValidationCode: validation.code,
      });
    }

    await this.effectiveRoutes.rebuild(userId);
    return this.get(userId);
  }

  async clearRole(userId: string, role: Exclude<AiSelectionRole, 'primary'>) {
    await this.repository.clearRole(userId, role);
    await this.effectiveRoutes.rebuild(userId);
    return this.get(userId);
  }

  async deleteCredential(userId: string, providerKey: string): Promise<void> {
    if (
      !this.catalog.provider(providerKey)
      && !this.audioCatalog.provider(providerKey)
      && !this.videoCatalog.provider(providerKey)
    ) {
      throw new NotFoundException('LLM_PROVIDER_NOT_FOUND');
    }
    await this.repository.deleteCredential(userId, providerKey);
    await this.effectiveRoutes.rebuild(userId);
  }

  private keyHint(apiKey: string): string {
    const value = apiKey.trim();
    return value.length <= 4 ? value : value.slice(-4);
  }

  private view(value: Awaited<ReturnType<UserLlmSettingsRepository['settings']>>) {
    const preference = value.preference;
    const isKnownProvider = (providerKey: string) => Boolean(
      this.catalog.provider(providerKey)
      || this.audioCatalog.provider(providerKey)
      || this.videoCatalog.provider(providerKey),
    );
    const credentials = value.credentials.filter((item) => isKnownProvider(item.providerKey));
    const roleView = (
      providerKey: string | null | undefined,
      modelKey: string | null | undefined,
    ) => {
      const selected = providerKey && modelKey ? this.catalog.model(providerKey, modelKey) : null;
      const credentialRow = providerKey
        ? credentials.find((item) => item.providerKey === providerKey) ?? null
        : null;
      return {
        providerKey: selected?.provider.providerKey ?? null,
        modelKey: selected?.model.modelKey ?? null,
        capabilities: selected?.model.capabilities ?? null,
        credential: this.credentialView(credentialRow),
      };
    };

    const primary = roleView(preference?.providerKey, preference?.modelKey);
    const vision = roleView(preference?.visionProviderKey, preference?.visionModelKey);
    const imageGeneration = roleView(preference?.imageProviderKey, preference?.imageModelKey);
    const videoSelected = preference?.videoProviderKey && preference?.videoModelKey
      ? this.videoCatalog.model(preference.videoProviderKey, preference.videoModelKey)
      : null;
    const videoCredential = videoSelected
      ? credentials.find((item) => item.providerKey === videoSelected.provider.providerKey) ?? null
      : null;
    const audioProvider = preference?.audioProviderKey
      ? this.audioCatalog.provider(preference.audioProviderKey)
      : null;
    const audioCredential = audioProvider
      ? credentials.find((item) => item.providerKey === audioProvider.providerKey) ?? null
      : null;

    return {
      primary,
      vision,
      imageGeneration,
      videoGeneration: {
        providerKey: videoSelected?.provider.providerKey ?? null,
        modelKey: videoSelected?.model.modelKey ?? null,
        capabilities: videoSelected?.model.capabilities ?? null,
        credential: this.credentialView(videoCredential),
      },
      audioGeneration: {
        providerKey: audioProvider?.providerKey ?? null,
        capabilities: audioProvider?.capabilities ?? null,
        speechModelKey: audioProvider?.speechModelKey ?? null,
        musicModelKey: audioProvider?.musicModelKey ?? null,
        credential: this.credentialView(audioCredential),
      },
      primarySupportsImageInput: primary.capabilities?.imageInput === true,
      credentials: credentials.map((item) => ({
        providerKey: item.providerKey,
        ...this.credentialView(item),
      })),
    };
  }

  private credentialView(value: {
    keyHint: string | null;
    status: string;
    verifiedAt: Date | null;
    lastValidationCode: string | null;
  } | null) {
    return {
      configured: Boolean(value),
      keyHint: value?.keyHint ?? null,
      status: value?.status ?? null,
      verifiedAt: value?.verifiedAt?.toISOString() ?? null,
      lastValidationCode: value?.lastValidationCode ?? null,
    };
  }
}
