import { Injectable } from '@nestjs/common';
import { UserLlmConfigResolverService } from '../llm-settings/application/user-llm-config-resolver.service';
import type {
  LLMRegistryPort,
  LLMResolvedConfig,
  LLMThinkingConfig,
} from './llm-registry.port';

@Injectable()
export class LLMRegistryService implements LLMRegistryPort {
  constructor(private readonly userConfig: UserLlmConfigResolverService) {}

  async resolve(input: {
    userId: string;
    agentId?: string | null;
    modelId?: string | null;
    override?: Partial<LLMResolvedConfig>;
  }): Promise<LLMResolvedConfig> {
    const resolved = await this.userConfig.resolve({
      userId: input.userId,
      requestedModelKey: input.modelId,
    });
    const requestedTemperature = input.override?.temperature ?? 0.3;

    return {
      provider: resolved.provider,
      providerKey: resolved.providerKey,
      apiMode: resolved.apiMode,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      temperature: resolved.supportsTemperature ? requestedTemperature : undefined,
      top_p: resolved.supportsTemperature ? input.override?.top_p : undefined,
      org: undefined,
      headers: resolved.headers,
      extra: input.override?.extra,
      systemPrompt: input.override?.systemPrompt,
      thinking: normalizeThinking(input.override?.thinking, resolved.supportsReasoning),
      supportsTools: resolved.supportsTools,
      supportsReasoning: resolved.supportsReasoning,
      supportsTemperature: resolved.supportsTemperature,
    };
  }
}

function normalizeThinking(
  value: LLMThinkingConfig | undefined,
  supported: boolean,
): LLMThinkingConfig | undefined {
  if (!supported) return { enabled: false, type: 'disabled' };
  return value;
}
