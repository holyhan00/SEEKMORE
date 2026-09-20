import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ModelGatewayModule } from '../seekmore-agent/runtime/model/model-gateway.module';
import { LlmSettingsModule } from '../llm-settings/llm-settings.module';
import { RuntimeObjectModule } from '../object-runtime/object/object.module';
import { WebSearchSettingsModule } from '../web-search-settings/web-search-settings.module';
import { AudioGenerationProviderRegistry } from './audio-generation/audio-generation-provider.registry';
import { AudioGenerationService } from './audio-generation/audio-generation.service';
import { ElevenLabsAudioAdapter } from './audio-generation/providers/elevenlabs-audio.adapter';
import { MiniMaxAudioAdapter } from './audio-generation/providers/minimax-audio.adapter';
import { QwenAudioAdapter } from './audio-generation/providers/qwen-audio.adapter';
import { UserVoiceAssetRepository } from './audio-generation/user-voice-asset.repository';
import { ArkImagesAdapter } from './image-generation/providers/ark-images.adapter';
import { DashScopeImageAdapter } from './image-generation/providers/dashscope-image.adapter';
import { GeminiImageAdapter } from './image-generation/providers/gemini-image.adapter';
import { GeminiInteractionsImageAdapter } from './image-generation/providers/gemini-interactions-image.adapter';
import { OpenAiImagesAdapter } from './image-generation/providers/openai-images.adapter';
import { XaiImagesAdapter } from './image-generation/providers/xai-images.adapter';
import { ImageGenerationService } from './image-generation/image-generation.service';
import { ImageReferencePreparationService } from './image-generation/image-reference-preparation.service';
import { ImageProviderRegistry } from './image-generation/image-provider.registry';
import { MediaTurnPreparationService } from './routing/media-turn-preparation.service';
import { RuntimeCapabilityContextBuilder } from './routing/runtime-capability-context.builder';
import { VisionService } from './vision/vision.service';
import { VideoModule } from './video/video.module';

@Global()
@Module({
  imports: [PrismaModule, RuntimeObjectModule, ModelGatewayModule, LlmSettingsModule, WebSearchSettingsModule, VideoModule],
  providers: [
    RuntimeCapabilityContextBuilder,
    MediaTurnPreparationService,
    VisionService,
    ImageGenerationService,
    ImageReferencePreparationService,
    ImageProviderRegistry,
    OpenAiImagesAdapter,
    GeminiInteractionsImageAdapter,
    GeminiImageAdapter,
    XaiImagesAdapter,
    DashScopeImageAdapter,
    ArkImagesAdapter,
    AudioGenerationService,
    AudioGenerationProviderRegistry,
    MiniMaxAudioAdapter,
    ElevenLabsAudioAdapter,
    QwenAudioAdapter,
    UserVoiceAssetRepository,
  ],
  exports: [
    MediaTurnPreparationService,
    VisionService,
    ImageGenerationService,
    AudioGenerationService,
    VideoModule,
  ],
})
export class MediaAiModule {}
