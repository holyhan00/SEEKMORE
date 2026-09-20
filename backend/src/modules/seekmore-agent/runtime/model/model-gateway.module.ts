import { Module } from '@nestjs/common';
import { RuntimeTraceModule } from '../../../../common/trace/runtime-trace.module';
import { AnthropicMessagesAdapter } from './adapters/anthropic-messages.adapter';
import { GeminiGenerateContentAdapter } from './adapters/gemini-generate-content.adapter';
import { OpenAiChatCompletionsAdapter } from './adapters/openai-chat-completions.adapter';
import { OpenAiResponsesAdapter } from './adapters/openai-responses.adapter';
import { ModelGatewayService } from './model-gateway.service';
import { ModelRetryPolicyService } from './model-retry-policy.service';

@Module({
  imports: [RuntimeTraceModule],
  providers: [
    ModelGatewayService,
    ModelRetryPolicyService,
    OpenAiChatCompletionsAdapter,
    OpenAiResponsesAdapter,
    AnthropicMessagesAdapter,
    GeminiGenerateContentAdapter,
  ],
  exports: [ModelGatewayService],
})
export class ModelGatewayModule {}
