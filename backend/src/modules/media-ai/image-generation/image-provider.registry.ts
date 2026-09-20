import { Injectable } from '@nestjs/common';
import type { ImageGenerationRequest, ImageProviderAdapter } from '../contracts/image-generation.types';
import { ArkImagesAdapter } from './providers/ark-images.adapter';
import { DashScopeImageAdapter } from './providers/dashscope-image.adapter';
import { GeminiImageAdapter } from './providers/gemini-image.adapter';
import { GeminiInteractionsImageAdapter } from './providers/gemini-interactions-image.adapter';
import { OpenAiImagesAdapter } from './providers/openai-images.adapter';
import { XaiImagesAdapter } from './providers/xai-images.adapter';

@Injectable()
export class ImageProviderRegistry {
  private readonly adapters: ImageProviderAdapter[];

  constructor(
    openAi: OpenAiImagesAdapter,
    gemini: GeminiImageAdapter,
    geminiInteractions: GeminiInteractionsImageAdapter,
    xai: XaiImagesAdapter,
    dashScope: DashScopeImageAdapter,
    ark: ArkImagesAdapter,
  ) {
    this.adapters = [openAi, geminiInteractions, gemini, xai, dashScope, ark];
  }

  resolve(config: ImageGenerationRequest['config']): ImageProviderAdapter {
    const adapter = this.adapters.find((item) => item.supports(config));
    if (!adapter) throw new Error('IMAGE_GENERATION_PROVIDER_NOT_FOUND');
    return adapter;
  }
}
