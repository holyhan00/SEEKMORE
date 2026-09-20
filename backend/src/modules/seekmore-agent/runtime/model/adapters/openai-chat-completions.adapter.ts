import { Injectable } from '@nestjs/common';
import type { AgentRuntimeMessage } from '../../../contracts/agent-turn.types';
import { ModelProviderError } from '../../errors/agent-runtime.errors';
import { bearerHeaders, postModelJson, releaseModelResponse, resolveChatCompletionsUrl } from '../model-http.util';
import type { ModelGenerationRequest, ModelGenerationResult, ModelProviderAdapter } from '../model.types';
import { contentText, openAiChatContent } from '../model-content.util';
import { decodeSse } from '../stream/sse-decoder';
import { ToolCallStreamAssembler } from '../stream/tool-call-assembler';
import { parseJsonObject, record, text } from '../../util/runtime.util';

@Injectable()
export class OpenAiChatCompletionsAdapter implements ModelProviderAdapter {
  readonly kind = 'openai_chat_completions';

  supports(route: { provider: string; apiMode?: string | null }): boolean {
    const mode = String(route.apiMode ?? '').toLowerCase();
    const provider = String(route.provider ?? '').toLowerCase();
    if (mode === 'responses' || mode === 'codex_responses' || mode === 'responses_basic_tools') return false;
    return !['anthropic', 'claude', 'gemini', 'google', 'bedrock'].includes(provider);
  }

  async generate(request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const toolMode = openAiToolMode(request.route.apiMode);
    const messageCompatibility = openAiMessageCompatibility(request.route.provider);
    const body: Record<string, unknown> = {
      model: request.route.model,
      messages: request.messages.map((message) =>
        toOpenAiMessage(message, messageCompatibility),
      ),
      stream: toolMode !== 'nonstream',
    };
    if (request.tools.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      if (toolMode === 'full') {
        body.tool_choice = 'auto';
        body.parallel_tool_calls = true;
      }
    }
    if (request.temperature != null) body.temperature = request.temperature;
    if (request.maxTokens != null) body.max_tokens = request.maxTokens;
    if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort;

    const response = await postModelJson({
      url: resolveChatCompletionsUrl(request.route.baseUrl),
      headers: bearerHeaders(request.route.apiKey, request.route.headers),
      body,
      signal: request.signal,
      totalTimeoutMs: request.totalTimeoutMs,
    });

    const assembler = new ToolCallStreamAssembler();
    let content = '';
    let reasoning = '';
    let finishReason: ModelGenerationResult['finishReason'] = 'unknown';
    let usage: ModelGenerationResult['usage'] = {};
    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.includes('text/event-stream')) {
      try {
        const payload = await response.json().catch(async () => ({
          raw: await response.text().catch(() => ''),
        }));
        return this.fromJson(payload, request);
      } finally {
        releaseModelResponse(response);
      }
    }

    for await (const frame of decodeSse(response, {
      signal: request.signal,
      firstTokenTimeoutMs: request.firstTokenTimeoutMs,
      idleTimeoutMs: request.idleTimeoutMs,
    })) {
      if (!frame.data || frame.data === '[DONE]') continue;
      let payload: Record<string, any>;
      try { payload = JSON.parse(frame.data); } catch { continue; }
      if (payload.error) {
        const error = record(payload.error);
        throw new ModelProviderError('MODEL_STREAM_ERROR', text(error.message || payload.error), true, payload.error);
      }
      if (payload.usage) usage = normalizeUsage(payload.usage);
      const choice = record(Array.isArray(payload.choices) ? payload.choices[0] : null);
      if (!Object.keys(choice).length) continue;
      if (choice.finish_reason) finishReason = normalizeFinishReason(choice.finish_reason);
      const delta = record(choice.delta);
      const contentDelta = extractContent(delta.content);
      if (contentDelta) {
        content += contentDelta;
        await request.onContentDelta?.(contentDelta);
      }
      const reasoningDelta = text(
        delta.reasoning_content
        ?? delta.reasoning
        ?? record(delta.provider_specific_fields).reasoning_content,
      );
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        await request.onReasoningDelta?.(reasoningDelta);
      }
      const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const rawCall of calls) {
        const call = record(rawCall);
        const fn = record(call.function);
        assembler.append({
          index: Number(call.index ?? 0),
          id: text(call.id) || null,
          name: text(fn.name) || null,
          argumentsDelta: text(fn.arguments) || null,
        });
      }
      if (delta.function_call) {
        const fn = record(delta.function_call);
        assembler.append({ index: 0, name: text(fn.name), argumentsDelta: text(fn.arguments) });
      }
    }

    const toolCalls = assembler.build(parseJsonObject);
    if (toolCalls.length && finishReason === 'unknown') finishReason = 'tool_calls';
    if (!toolCalls.length && finishReason === 'unknown') finishReason = 'stop';
    return {
      provider: request.route.provider,
      model: request.route.model,
      content,
      reasoning,
      toolCalls,
      finishReason,
      usage,
      metadata: { adapter: this.kind },
    };
  }

  private async fromJson(payload: unknown, request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const root = record(payload);
    if (root.error) {
      const error = record(root.error);
      throw new ModelProviderError('MODEL_RESPONSE_ERROR', text(error.message || root.error), false, root.error);
    }
    const choice = record(Array.isArray(root.choices) ? root.choices[0] : null);
    const message = record(choice.message);
    const content = extractContent(message.content);
    if (content) await request.onContentDelta?.(content);
    const reasoning = text(message.reasoning_content ?? message.reasoning);
    if (reasoning) await request.onReasoningDelta?.(reasoning);
    const assembler = new ToolCallStreamAssembler();
    for (const [index, rawCall] of (Array.isArray(message.tool_calls) ? message.tool_calls : []).entries()) {
      const call = record(rawCall);
      const fn = record(call.function);
      assembler.set({ index, id: text(call.id), name: text(fn.name), arguments: fn.arguments });
    }
    return {
      provider: request.route.provider,
      model: request.route.model,
      content,
      reasoning,
      toolCalls: assembler.build(parseJsonObject),
      finishReason: normalizeFinishReason(choice.finish_reason),
      usage: normalizeUsage(root.usage),
      metadata: { adapter: this.kind, nonStreamingFallback: true },
    };
  }
}

export function toOpenAiMessage(
  message: AgentRuntimeMessage,
  compatibility: {
    replayReasoningContent: boolean;
    requireAssistantContent: boolean;
  } = {
    replayReasoningContent: false,
    requireAssistantContent: false,
  },
): Record<string, unknown> {
  if (message.role === 'assistant' && message.toolCalls?.length) {
    const content = normalizeContent(message.content);
    return {
      role: 'assistant',
      content: content || (compatibility.requireAssistantContent ? '' : null),
      ...(compatibility.replayReasoningContent
        ? { reasoning_content: normalizeContent(message.reasoningContent) }
        : {}),
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.rawArguments || JSON.stringify(call.arguments ?? {}) },
      })),
    };
  }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: normalizeContent(message.content),
    };
  }
  return { role: message.role, content: openAiChatContent(message.content),
    ...(message.role === 'assistant' && compatibility.replayReasoningContent
      ? { reasoning_content: normalizeContent(message.reasoningContent) } : {}) };
}

export function openAiMessageCompatibility(provider: unknown): {
  replayReasoningContent: boolean;
  requireAssistantContent: boolean;
} {
  const deepSeek = String(provider ?? '').trim().toLowerCase() === 'deepseek';
  return {
    replayReasoningContent: deepSeek,
    requireAssistantContent: deepSeek,
  };
}

function normalizeContent(value: unknown): string {
  return contentText(value);
}

function extractContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    const item = record(part);
    return text(item.text ?? item.content);
  }).join('');
}

function normalizeFinishReason(value: unknown): ModelGenerationResult['finishReason'] {
  const reason = text(value).toLowerCase();
  if (reason === 'stop') return 'stop';
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_calls';
  if (reason === 'length' || reason === 'max_tokens') return 'length';
  if (reason === 'content_filter') return 'content_filter';
  return reason ? 'unknown' : 'unknown';
}

function normalizeUsage(value: unknown): ModelGenerationResult['usage'] {
  const usage = record(value);
  const promptDetails = record(usage.prompt_tokens_details);
  return {
    inputTokens: number(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: number(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: number(usage.total_tokens),
    cachedInputTokens: number(promptDetails.cached_tokens ?? usage.cached_input_tokens),
  };
}

function number(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function openAiToolMode(apiMode: string | null | undefined): 'full' | 'basic' | 'nonstream' {
  const mode = String(apiMode ?? '').toLowerCase();
  if (mode === 'chat_completions_nonstream_tools') return 'nonstream';
  if (mode === 'chat_completions_basic_tools') return 'basic';
  return 'full';
}
