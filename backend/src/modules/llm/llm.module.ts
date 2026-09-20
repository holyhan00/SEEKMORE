                                        
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LlmSettingsModule } from '../llm-settings/llm-settings.module';
import { LLMRegistryToken } from './llm-registry.port';
import { LLMRegistryService } from './llm-registry.service';
import { LLMClientService } from './llm-client.service';
import { LlmProviderClientService } from './provider/llm-provider-client.service';

@Module({
  imports: [ConfigModule, PrismaModule, LlmSettingsModule],
  providers: [
    LLMRegistryService,
    { provide: LLMRegistryToken, useExisting: LLMRegistryService },
    LlmProviderClientService,
    LLMClientService,
  ],
  exports: [
    LLMRegistryToken,
    LLMRegistryService,
    LLMClientService,
  ],
})
export class LLMModule {}
