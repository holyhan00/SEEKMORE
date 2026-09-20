                                                                                
import type { AudioGenerationProviderDefinition } from '../contracts/llm-settings.types';

export const AUDIO_GENERATION_PROVIDER_CATALOG: readonly AudioGenerationProviderDefinition[] = [
  {
    providerKey: 'minimax',
    displayName: 'MiniMax',
    baseUrl: 'https://api.minimax.io/v1',
    apiKeyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    docsUrl: 'https://platform.minimax.io/docs/api-reference/api-overview',
    enabled: true,
    sortOrder: 10,
    speechModelKey: 'speech-2.8-hd',
    musicModelKey: 'music-3.0',
    defaultVoiceId: 'Chinese (Mandarin)_Reliable_Executive',
    capabilities: {
      speechGeneration: true,
      voiceCloning: true,
      musicGeneration: true,
      access: {
        speechGeneration: 'available',
        voiceCloning: 'plan_dependent',
        musicGeneration: 'available',
      },
    },
  },
  {
    providerKey: 'elevenlabs',
    displayName: 'ElevenLabs',
    baseUrl: 'https://api.elevenlabs.io/v1',
    apiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    docsUrl: 'https://elevenlabs.io/docs/api-reference/introduction',
    enabled: true,
    sortOrder: 20,
    speechModelKey: 'eleven_v3',
    musicModelKey: 'music_v2',
    capabilities: {
      speechGeneration: true,
      voiceCloning: true,
      musicGeneration: true,
      access: {
        speechGeneration: 'available',
        voiceCloning: 'plan_dependent',
        musicGeneration: 'paid_only',
      },
    },
  },
  {
    providerKey: 'qwen',
    displayName: '阿里云百炼 / Qwen Audio',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1&tab=model',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/tts-model',
    enabled: true,
    sortOrder: 30,
    speechModelKey: 'qwen-audio-3.0-tts-plus',
    speechModelKeys: ['qwen-audio-3.0-tts-plus', 'qwen-audio-3.0-tts-flash'],
    musicModelKey: 'fun-music-v1',
    musicModelKeys: ['fun-music-v1'],
    defaultVoiceId: 'longanlingxin',
    capabilities: {
      speechGeneration: true,
      voiceCloning: false,
      musicGeneration: true,
      access: {
        speechGeneration: 'available',
        voiceCloning: 'plan_dependent',
        musicGeneration: 'plan_dependent',
      },
    },
  },
] as const;