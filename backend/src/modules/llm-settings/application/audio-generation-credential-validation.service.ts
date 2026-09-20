import { Injectable } from '@nestjs/common';
import type {
  AudioGenerationProviderDefinition,
  LlmCredentialValidationResult,
} from '../contracts/llm-settings.types';

   
                                                                            
  
                                                                              
                                                                           
                                                                                
                                                                             
                          
   
@Injectable()
export class AudioGenerationCredentialValidationService {
  async validate(input: {
    provider: AudioGenerationProviderDefinition;
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
