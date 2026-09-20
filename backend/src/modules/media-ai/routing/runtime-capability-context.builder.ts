import { Injectable } from '@nestjs/common';
import { EffectiveMediaRouteService } from '../../llm-settings/application/effective-media-route.service';
import type { ResolvedUserLlmConfig } from '../../llm-settings/contracts/llm-settings.types';
import { WebSearchSettingsService } from '../../web-search-settings/application/web-search-settings.service';
import { VideoGenerationRouteService } from '../video/video-generation-route.service';

@Injectable()
export class RuntimeCapabilityContextBuilder {
  constructor(
    private readonly mediaRoutes: EffectiveMediaRouteService,
    private readonly webSearch: WebSearchSettingsService,
    private readonly videoRoutes: VideoGenerationRouteService,
  ) {}

  async build(input: {
    userId: string;
    primary: ResolvedUserLlmConfig;
    workflowActive: boolean;
  }) {
    const [routes, search, video] = await Promise.all([
      this.mediaRoutes.get(input.userId),
      this.webSearch.resolveOptional(input.userId),
      this.videoRoutes.availability(input.userId),
    ]);

    return {
      context: {
        runtimeContextType: 'runtime_capabilities',
        primaryModel: {
          providerKey: input.primary.providerKey,
          modelKey: input.primary.model,
          capabilities: input.primary.capabilities,
        },
        vision: routeContext(routes.vision),
        imageGeneration: routeContext(routes.imageGeneration),
        videoGeneration: video.status === 'available'
          ? { status: 'available', providerKeys: video.providerKeys }
          : { status: 'unavailable', reasonCode: video.reasonCode },
        speechGeneration: routeContext(routes.speechGeneration),
        musicGeneration: routeContext(routes.musicGeneration),
        voiceCloning: routeContext(routes.voiceCloning),
        webSearch: search
          ? { status: 'available', providerKey: search.providerKey }
          : { status: 'unavailable', reasonCode: 'WEB_SEARCH_NOT_CONFIGURED' },
        workflow: { active: input.workflowActive },
      },
      disabledToolNames: [
        ...(routes.vision.status === 'unavailable' ? ['vision.analyze'] : []),
        ...(routes.imageGeneration.status === 'unavailable' ? ['image.generate'] : []),
        ...(video.status === 'unavailable' ? ['video.generate'] : []),
        ...(routes.speechGeneration.status === 'unavailable' ? ['speech.synthesize'] : []),
        ...(routes.musicGeneration.status === 'unavailable' ? ['music.generate'] : []),
        ...(routes.voiceCloning.status === 'unavailable' ? ['voice.clone'] : []),
        ...(!search ? ['web.search'] : []),
      ],
    };
  }
}

function routeContext(route: Awaited<ReturnType<EffectiveMediaRouteService['get']>>['vision']) {
  return route.status === 'available'
    ? {
        status: 'available',
        source: route.source,
        providerKey: route.providerKey,
        modelKey: route.modelKey,
      }
    : {
        status: 'unavailable',
        source: 'none',
        reasonCode: route.reasonCode,
      };
}
