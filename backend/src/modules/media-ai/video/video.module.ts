import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { RuntimeObjectModule } from '../../object-runtime/object/object.module';
import { DoubaoSeedanceVideoAdapter } from './providers/doubao-seedance-video.adapter';
import { GoogleVeoVideoAdapter } from './providers/google-veo-video.adapter';
import { MiniMaxVideoAdapter } from './providers/minimax-video.adapter';
import { QwenWanVideoAdapter } from './providers/qwen-wan-video.adapter';
import { TencentHunyuanVideoAdapter } from './providers/tencent-hunyuan-video.adapter';
import { ViduVideoAdapter } from './providers/vidu-video.adapter';
import { ZhipuVideoAdapter } from './providers/zhipu-video.adapter';
import { VideoGenerationRouteService } from './video-generation-route.service';
import { VideoGenerationService } from './video-generation.service';
import { VideoProviderRegistry } from './video-provider.registry';
import { VideoReferencePreparationService } from './video-reference-preparation.service';

@Module({
  imports: [PrismaModule, RuntimeObjectModule],
  providers: [
    VideoGenerationRouteService,
    VideoGenerationService,
    VideoProviderRegistry,
    VideoReferencePreparationService,
    GoogleVeoVideoAdapter,
    MiniMaxVideoAdapter,
    DoubaoSeedanceVideoAdapter,
    ViduVideoAdapter,
    ZhipuVideoAdapter,
    TencentHunyuanVideoAdapter,
    QwenWanVideoAdapter,
  ],
  exports: [
    VideoGenerationRouteService,
    VideoGenerationService,
  ],
})
export class VideoModule {}
