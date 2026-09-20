import { BadRequestException, Injectable } from '@nestjs/common';
import { DoubaoSeedanceVideoAdapter } from './providers/doubao-seedance-video.adapter';
import { GoogleVeoVideoAdapter } from './providers/google-veo-video.adapter';
import { MiniMaxVideoAdapter } from './providers/minimax-video.adapter';
import { QwenWanVideoAdapter } from './providers/qwen-wan-video.adapter';
import { TencentHunyuanVideoAdapter } from './providers/tencent-hunyuan-video.adapter';
import { ViduVideoAdapter } from './providers/vidu-video.adapter';
import { ZhipuVideoAdapter } from './providers/zhipu-video.adapter';
import type {
  ResolvedVideoProvider,
  VideoProviderAdapter,
  VideoProviderCredential,
  VideoProviderRequest,
} from './video-generation.types';

@Injectable()
export class VideoProviderRegistry {
  private readonly adapters: VideoProviderAdapter[];

  constructor(
    google: GoogleVeoVideoAdapter,
    minimax: MiniMaxVideoAdapter,
    doubao: DoubaoSeedanceVideoAdapter,
    vidu: ViduVideoAdapter,
    zhipu: ZhipuVideoAdapter,
    hunyuan: TencentHunyuanVideoAdapter,
    qwen: QwenWanVideoAdapter,
  ) {
    this.adapters = [google, minimax, doubao, vidu, zhipu, hunyuan, qwen];
  }

  resolve(input: {
    credentials: VideoProviderCredential[];
    request: VideoProviderRequest;
    requestedProviderKey?: string | null;
  }): ResolvedVideoProvider {
    const requested = String(input.requestedProviderKey ?? '').trim();
    const credentials = requested
      ? input.credentials.filter((credential) => credential.providerKey === requested)
      : input.credentials;

    if (requested && credentials.length === 0) {
      throw new BadRequestException('VIDEO_PROVIDER_NOT_CONFIGURED');
    }

    for (const credential of credentials) {
      const adapter = this.adapters.find((item) => item.providerKey === credential.providerKey);
      if (adapter?.supports(input.request)) {
        return { credential, adapter };
      }
    }

    if (requested) {
      throw new BadRequestException('VIDEO_PROVIDER_REQUEST_UNSUPPORTED');
    }
    throw new BadRequestException('VIDEO_GENERATION_ROUTE_UNAVAILABLE');
  }
}
