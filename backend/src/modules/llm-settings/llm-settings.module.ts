import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LlmSettingsController } from './api/llm-settings.controller';
import { AudioGenerationCredentialValidationService } from './application/audio-generation-credential-validation.service';
import { EffectiveMediaRouteService } from './application/effective-media-route.service';
import { LlmSettingsService } from './application/llm-settings.service';
import { LlmCredentialValidationService } from './application/llm-credential-validation.service';
import { VideoGenerationCredentialValidationService } from './application/video-generation-credential-validation.service';
import { UserLlmConfigResolverService } from './application/user-llm-config-resolver.service';
import { AudioGenerationProviderCatalogService } from './catalog/audio-generation-provider-catalog.service';
import { LlmProviderCatalogService } from './catalog/llm-provider-catalog.service';
import { VideoGenerationProviderCatalogService } from './catalog/video-generation-provider-catalog.service';
import { UserLlmSettingsRepository } from './persistence/user-llm-settings.repository';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LlmSettingsController],
  providers: [
    LlmSettingsService,
    LlmCredentialValidationService,
    AudioGenerationCredentialValidationService,
    VideoGenerationCredentialValidationService,
    EffectiveMediaRouteService,
    UserLlmConfigResolverService,
    LlmProviderCatalogService,
    AudioGenerationProviderCatalogService,
    VideoGenerationProviderCatalogService,
    UserLlmSettingsRepository,
  ],
  exports: [
    UserLlmConfigResolverService,
    EffectiveMediaRouteService,
    LlmProviderCatalogService,
    AudioGenerationProviderCatalogService,
    VideoGenerationProviderCatalogService,
  ],
})
export class LlmSettingsModule {}
