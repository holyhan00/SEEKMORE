import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { AudioGenerationProviderCatalogService } from '../catalog/audio-generation-provider-catalog.service';
import { LlmProviderCatalogService } from '../catalog/llm-provider-catalog.service';
import type {
  EffectiveMediaCapability,
  EffectiveMediaRoute,
  EffectiveMediaRoutes,
  ResolvedAudioGenerationConfig,
  ResolvedUserLlmConfig,
} from '../contracts/llm-settings.types';
import { UserLlmSettingsRepository } from '../persistence/user-llm-settings.repository';
import { UserLlmConfigResolverService } from './user-llm-config-resolver.service';

const IMAGE_GENERATION_PROTOCOLS = new Set([
  'openai_images',
  'gemini_image',
  'gemini_interactions_image',
  'xai_images',
  'dashscope_multimodal_image',
  'ark_images',
]);

type EffectiveMediaExecutionSnapshot = {
  version: number;
  vision: ResolvedUserLlmConfig | null;
  imageGeneration: ResolvedUserLlmConfig | null;
  speechGeneration: ResolvedAudioGenerationConfig | null;
  musicGeneration: ResolvedAudioGenerationConfig | null;
  voiceCloning: ResolvedAudioGenerationConfig | null;
};

type ResolvedExecution<T> = {
  config: T | null;
  reasonCode: string | null;
};

@Injectable()
export class EffectiveMediaRouteService implements OnApplicationBootstrap {
  private readonly routeCache = new Map<string, EffectiveMediaRoutes>();
  private readonly executionCache = new Map<string, EffectiveMediaExecutionSnapshot>();
  private nextVersion = 1;

  constructor(
    private readonly repository: UserLlmSettingsRepository,
    private readonly catalog: LlmProviderCatalogService,
    private readonly audioCatalog: AudioGenerationProviderCatalogService,
    private readonly models: UserLlmConfigResolverService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const preferences = await this.repository.preferences().catch(() => []);
    await Promise.allSettled(
      preferences.map((preference) => this.rebuild(preference.userId)),
    );
  }

  async get(userId: string): Promise<EffectiveMediaRoutes> {
    const normalized = this.userId(userId);
    const routes = this.routeCache.get(normalized);
    const execution = this.executionCache.get(normalized);
    if (routes && execution?.version === routes.version) return routes;
    return this.rebuild(normalized);
  }

  async rebuild(userId: string): Promise<EffectiveMediaRoutes> {
    const normalized = this.userId(userId);
    const { preference, credentials } = await this.repository.settings(normalized);
    const credentialProviders = new Set<string>(
      credentials
        .filter((credential) =>
          String(credential.apiKey ?? '').trim().length > 0
          && String(credential.status ?? '').toUpperCase() !== 'INVALID'
        )
        .map((credential) => String(credential.providerKey ?? '').trim())
        .filter(Boolean),
    );

    const primary = preference?.providerKey && preference.modelKey
      ? this.catalog.modelForRole(preference.providerKey, preference.modelKey, 'primary')
      : null;

    const candidateRoutes = {
      vision: this.modelRoute({
        capability: 'vision',
        configuredProviderKey: preference?.visionProviderKey,
        configuredModelKey: preference?.visionModelKey,
        configuredRole: 'vision',
        configuredCapability: 'imageInput',
        primary,
        primaryCapability: 'imageInput',
        credentials: credentialProviders,
        unavailableCode: 'VISION_MODEL_UNAVAILABLE',
      }),
      imageGeneration: this.modelRoute({
        capability: 'image_generation',
        configuredProviderKey: preference?.imageProviderKey,
        configuredModelKey: preference?.imageModelKey,
        configuredRole: 'image_generation',
        configuredCapability: 'imageOutput',
        primary,
        primaryCapability: 'imageOutput',
        credentials: credentialProviders,
        unavailableCode: 'IMAGE_GENERATION_UNAVAILABLE',
        protocolAllowed: (protocol) => IMAGE_GENERATION_PROTOCOLS.has(protocol),
      }),
    };

    const audioProviderKey = String(preference?.audioProviderKey ?? '').trim();
    const configuredAudio = audioProviderKey
      ? this.audioCatalog.provider(audioProviderKey)
      : null;

    const audioRoutes = {
      speechGeneration: this.audioRoute({
        capability: 'speech_generation',
        configuredProviderKey: audioProviderKey,
        configuredProvider: configuredAudio,
        capabilityKey: 'speechGeneration',
        modelKey: configuredAudio?.speechModelKey ?? null,
        primary,
        credentials: credentialProviders,
        unavailableCode: 'SPEECH_GENERATION_UNAVAILABLE',
      }),
      musicGeneration: this.audioRoute({
        capability: 'music_generation',
        configuredProviderKey: audioProviderKey,
        configuredProvider: configuredAudio,
        capabilityKey: 'musicGeneration',
        modelKey: configuredAudio?.musicModelKey ?? null,
        primary,
        credentials: credentialProviders,
        unavailableCode: 'MUSIC_GENERATION_UNAVAILABLE',
      }),
      voiceCloning: this.audioRoute({
        capability: 'voice_cloning',
        configuredProviderKey: audioProviderKey,
        configuredProvider: configuredAudio,
        capabilityKey: 'voiceCloning',
        modelKey: configuredAudio?.speechModelKey ?? null,
        primary,
        credentials: credentialProviders,
        unavailableCode: 'VOICE_CLONING_UNAVAILABLE',
      }),
    };

    const [visionExecution, imageExecution, speechExecution, musicExecution, voiceExecution] =
      await Promise.all([
        this.resolveModelExecutionConfig(normalized, candidateRoutes.vision, 'vision'),
        this.resolveModelExecutionConfig(normalized, candidateRoutes.imageGeneration, 'image_generation'),
        this.resolveAudioExecutionConfig(normalized, audioRoutes.speechGeneration),
        this.resolveAudioExecutionConfig(normalized, audioRoutes.musicGeneration),
        this.resolveAudioExecutionConfig(normalized, audioRoutes.voiceCloning),
      ]);

    const version = this.nextVersion++;
    const snapshot: EffectiveMediaRoutes = {
      version,
      resolvedAt: new Date().toISOString(),
      vision: executionRoute(candidateRoutes.vision, visionExecution),
      imageGeneration: executionRoute(candidateRoutes.imageGeneration, imageExecution),
      speechGeneration: executionRoute(audioRoutes.speechGeneration, speechExecution),
      musicGeneration: executionRoute(audioRoutes.musicGeneration, musicExecution),
      voiceCloning: executionRoute(audioRoutes.voiceCloning, voiceExecution),
    };

    this.routeCache.set(normalized, snapshot);
    this.executionCache.set(normalized, {
      version,
      vision: snapshot.vision.status === 'available' ? visionExecution.config : null,
      imageGeneration: snapshot.imageGeneration.status === 'available' ? imageExecution.config : null,
      speechGeneration: snapshot.speechGeneration.status === 'available' ? speechExecution.config : null,
      musicGeneration: snapshot.musicGeneration.status === 'available' ? musicExecution.config : null,
      voiceCloning: snapshot.voiceCloning.status === 'available' ? voiceExecution.config : null,
    });

    return snapshot;
  }

  invalidate(userId: string): void {
    const normalized = this.userId(userId);
    this.routeCache.delete(normalized);
    this.executionCache.delete(normalized);
  }

  async resolveVisionExecution(userId: string): Promise<ResolvedUserLlmConfig> {
    return this.modelExecution(userId, 'vision');
  }

  async resolveImageGenerationExecution(userId: string): Promise<ResolvedUserLlmConfig> {
    return this.modelExecution(userId, 'imageGeneration');
  }

  async resolveAudioExecution(
    userId: string,
    capability: 'speech_generation' | 'music_generation' | 'voice_cloning',
  ): Promise<ResolvedAudioGenerationConfig> {
    const routes = await this.get(userId);
    const execution = this.executionCache.get(this.userId(userId));
    if (!execution || execution.version !== routes.version) {
      throw new Error('MEDIA_ROUTE_STALE');
    }

    const route = capability === 'speech_generation'
      ? routes.speechGeneration
      : capability === 'music_generation'
        ? routes.musicGeneration
        : routes.voiceCloning;
    const config = capability === 'speech_generation'
      ? execution.speechGeneration
      : capability === 'music_generation'
        ? execution.musicGeneration
        : execution.voiceCloning;

    if (route.status !== 'available') throw new Error(route.reasonCode);
    if (!config) throw new Error('MEDIA_ROUTE_STALE');
    return config;
  }

  private async modelExecution(
    userId: string,
    capability: 'vision' | 'imageGeneration',
  ): Promise<ResolvedUserLlmConfig> {
    const normalized = this.userId(userId);
    const routes = await this.get(normalized);
    const execution = this.executionCache.get(normalized);
    if (!execution || execution.version !== routes.version) {
      throw new Error('MEDIA_ROUTE_STALE');
    }

    const route = capability === 'vision' ? routes.vision : routes.imageGeneration;
    const config = capability === 'vision' ? execution.vision : execution.imageGeneration;
    if (route.status !== 'available') throw new Error(route.reasonCode);
    if (!config) throw new Error('MEDIA_ROUTE_STALE');
    return config;
  }

  private async resolveModelExecutionConfig(
    userId: string,
    route: EffectiveMediaRoute,
    configuredRole: 'vision' | 'image_generation',
  ): Promise<ResolvedExecution<ResolvedUserLlmConfig>> {
    if (route.status !== 'available') {
      return { config: null, reasonCode: route.reasonCode };
    }

    try {
      const config = route.source === 'configured'
        ? await this.models.resolveRole(userId, configuredRole)
        : await this.models.resolve({ userId });
      if (config.providerKey !== route.providerKey || config.model !== route.modelKey) {
        return { config: null, reasonCode: 'MEDIA_ROUTE_STALE' };
      }
      return { config, reasonCode: null };
    } catch (error) {
      return { config: null, reasonCode: errorCode(error, 'MEDIA_ROUTE_INVALID') };
    }
  }

  private async resolveAudioExecutionConfig(
    userId: string,
    route: EffectiveMediaRoute,
  ): Promise<ResolvedExecution<ResolvedAudioGenerationConfig>> {
    if (route.status !== 'available') {
      return { config: null, reasonCode: route.reasonCode };
    }

    try {
      const config = await this.models.resolveAudioProvider(userId, route.providerKey);
      if (config.providerKey !== route.providerKey) {
        return { config: null, reasonCode: 'MEDIA_ROUTE_STALE' };
      }
      return { config, reasonCode: null };
    } catch (error) {
      return { config: null, reasonCode: errorCode(error, 'MEDIA_ROUTE_INVALID') };
    }
  }

  private modelRoute(input: {
    capability: EffectiveMediaCapability;
    configuredProviderKey?: string | null;
    configuredModelKey?: string | null;
    configuredRole: 'vision' | 'image_generation';
    configuredCapability: 'imageInput' | 'imageOutput';
    primary: ReturnType<LlmProviderCatalogService['modelForRole']>;
    primaryCapability: 'imageInput' | 'imageOutput';
    credentials: Set<string>;
    unavailableCode: string;
    protocolAllowed?: (protocol: string) => boolean;
  }): EffectiveMediaRoute {
    const configuredProviderKey = String(input.configuredProviderKey ?? '').trim();
    const configuredModelKey = String(input.configuredModelKey ?? '').trim();
    const hasExplicitSelection = Boolean(configuredProviderKey || configuredModelKey);

    if (hasExplicitSelection) {
      const selected = configuredProviderKey && configuredModelKey
        ? this.catalog.modelForRole(
            configuredProviderKey,
            configuredModelKey,
            input.configuredRole,
          )
        : null;
      if (!selected) return unavailable(input.capability, `${input.unavailableCode}:CONFIG_INVALID`);
      if (!selected.model.capabilities[input.configuredCapability]) {
        return unavailable(input.capability, `${input.unavailableCode}:CAPABILITY_MISMATCH`);
      }
      const protocol = this.catalog.protocol(selected.provider, selected.model);
      if (input.protocolAllowed && !input.protocolAllowed(protocol)) {
        return unavailable(input.capability, `${input.unavailableCode}:ADAPTER_UNAVAILABLE`);
      }
      if (!input.credentials.has(selected.provider.providerKey)) {
        return unavailable(input.capability, `${input.unavailableCode}:CREDENTIAL_MISSING`);
      }
      return available(
        input.capability,
        'configured',
        selected.provider.providerKey,
        selected.model.modelKey,
        input.configuredRole,
      );
    }

    if (
      input.primary
      && input.primary.model.capabilities[input.primaryCapability]
      && input.credentials.has(input.primary.provider.providerKey)
    ) {
      const protocol = this.catalog.protocol(input.primary.provider, input.primary.model);
      if (!input.protocolAllowed || input.protocolAllowed(protocol)) {
        return available(
          input.capability,
          'primary',
          input.primary.provider.providerKey,
          input.primary.model.modelKey,
          'primary',
        );
      }
    }

    return unavailable(input.capability, input.unavailableCode);
  }

  private audioRoute(input: {
    capability: EffectiveMediaCapability;
    configuredProviderKey: string;
    configuredProvider: ReturnType<AudioGenerationProviderCatalogService['provider']>;
    capabilityKey: 'speechGeneration' | 'musicGeneration' | 'voiceCloning';
    modelKey: string | null;
    primary: ReturnType<LlmProviderCatalogService['modelForRole']>;
    credentials: Set<string>;
    unavailableCode: string;
  }): EffectiveMediaRoute {
    if (input.configuredProviderKey) {
      if (!input.configuredProvider) {
        return unavailable(input.capability, `${input.unavailableCode}:CONFIG_INVALID`);
      }
      if (!input.configuredProvider.capabilities[input.capabilityKey]) {
        return unavailable(input.capability, `${input.unavailableCode}:CAPABILITY_MISMATCH`);
      }
      if (!input.credentials.has(input.configuredProvider.providerKey)) {
        return unavailable(input.capability, `${input.unavailableCode}:CREDENTIAL_MISSING`);
      }
      return available(
        input.capability,
        'configured',
        input.configuredProvider.providerKey,
        input.modelKey,
        'audio_generation',
      );
    }

    if (input.primary?.model.capabilities[input.capabilityKey]) {
      const provider = this.audioCatalog.provider(input.primary.provider.providerKey);
      if (
        provider?.capabilities[input.capabilityKey]
        && input.credentials.has(provider.providerKey)
      ) {
        const modelKey = input.capabilityKey === 'musicGeneration'
          ? provider.musicModelKey
          : provider.speechModelKey;
        return available(
          input.capability,
          'primary',
          provider.providerKey,
          modelKey,
          'primary',
        );
      }
    }

    return unavailable(input.capability, input.unavailableCode);
  }

  private userId(value: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) throw new Error('USER_LLM_SETTINGS_REQUIRED');
    return normalized;
  }
}

function available(
  capability: EffectiveMediaCapability,
  source: 'configured' | 'primary',
  providerKey: string,
  modelKey: string | null,
  selectionRole: 'primary' | 'vision' | 'image_generation' | 'audio_generation',
): EffectiveMediaRoute {
  return {
    status: 'available',
    capability,
    source,
    providerKey,
    modelKey,
    selectionRole,
  };
}

function unavailable(
  capability: EffectiveMediaCapability,
  reasonCode: string,
): EffectiveMediaRoute {
  return {
    status: 'unavailable',
    capability,
    source: 'none',
    reasonCode,
  };
}

function executionRoute<T>(
  route: EffectiveMediaRoute,
  execution: ResolvedExecution<T>,
): EffectiveMediaRoute {
  if (route.status === 'unavailable') return route;
  return execution.config
    ? route
    : unavailable(route.capability, execution.reasonCode ?? 'MEDIA_ROUTE_INVALID');
}

function errorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim() || fallback;
}
