import { Injectable } from '@nestjs/common';
import type { LlmCredentialValidationResult } from '../contracts/llm-settings.types';
import type { VideoGenerationProviderDefinition } from '../../media-ai/video/video-generation.types';

@Injectable()
export class VideoGenerationCredentialValidationService {
  async validate(input: {
    provider: VideoGenerationProviderDefinition;
    apiKey: string;
  }): Promise<LlmCredentialValidationResult> {
    const apiKey = String(input.apiKey ?? '').trim();
    void input.provider;

    if (!apiKey) {
      return {
        status: 'INVALID',
        code: 'LLM_API_KEY_REQUIRED',
        verifiedAt: null,
      };
    }

    return {
      status: 'UNVERIFIED',
      code: 'LLM_CREDENTIAL_SAVED_UNVERIFIED',
      verifiedAt: null,
    };
  }
}
