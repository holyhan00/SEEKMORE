                                               
import { InjectionToken } from '@nestjs/common';

export type ProviderKind = string;

export type LLMThinkingConfig = {
  enabled?: boolean;
  type?: 'enabled' | 'disabled';
  reasoningEffort?: 'high' | 'max';
};

export type LLMResolvedConfig = {
  provider: ProviderKind;
  providerKey?: string;
  apiMode?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  top_p?: number;
  org?: string;
  headers?: Record<string, string>;
  extra?: Record<string, any>;
  systemPrompt?: string;
  thinking?: LLMThinkingConfig;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  supportsTemperature?: boolean;
};

export interface LLMRegistryPort {
  resolve(input: {
    userId: string;
    agentId?: string | null;
    modelId?: string | null;
    override?: Partial<LLMResolvedConfig>;
  }): Promise<LLMResolvedConfig>;
}

export const LLMRegistryToken: InjectionToken = 'LLMRegistryPort';
