import { Injectable } from '@nestjs/common';
import type { AgentRuntimeMessage } from '../../../contracts/agent-turn.types';
import { ModelProviderError } from '../../errors/agent-runtime.errors';
import { bearerHeaders, postModelJson, resolveResponsesUrl } from '../model-http.util';
import type { ModelGenerationRequest, ModelGenerationResult, ModelProviderAdapter } from '../model.types';
import { contentText, openAiResponseContent } from '../model-content.util';
import { decodeSse } from '../stream/sse-decoder';
import { ToolCallStreamAssembler } from '../stream/tool-call-assembler';
import { parseJsonObject, record, text } from '../../util/runtime.util';

@Injectable()
export class OpenAiResponsesAdapter implements ModelProviderAdapter {
  readonly kind = 'openai_responses';

  supports(route: { provider: string; apiMode?: string | null }): boolean {
    const mode = String(route.apiMode ?? '').toLowerCase();
    const provider = String(route.provider ?? '').toLowerCase();
    return mode === 'responses'
      || mode === 'codex_responses'
      || mode === 'responses_basic_tools'
      || provider === 'openai-codex';
  }

  async generate(request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const basicTools = String(request.route.apiMode ?? '').toLowerCase() === 'responses_basic_tools';
    const body: Record<string, unknown> = {
      model: request.route.model,
      input: request.messages.map(toResponseInput),
      stream: true,
    };
    if (request.tools.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));
      if (!basicTools) {
        body.tool_choice = 'auto';
        body.parallel_tool_calls = true;
      }
    }
    if (request.maxTokens != null) body.max_output_tokens = request.maxTokens;
    if (request.reasoningEffort) body.reasoning = { effort: request.reasoningEffort };

    const response = await postModelJson({
      url: resolveResponsesUrl(request.route.baseUrl),
      headers: bearerHeaders(request.route.apiKey, request.route.headers),
      body,
      signal: request.signal,
      totalTimeoutMs: request.totalTimeoutMs,
    });
    const assembler = new ToolCallStreamAssembler();
    const itemIndexes = new Map<string, number>();
    let content = '';
    let reasoning = '';
    let usage: ModelGenerationResult['usage'] = {};
    let finishReason: ModelGenerationResult['finishReason'] = 'unknown';

    for await (const frame of decodeSse(response, {
      signal: request.signal,
      firstTokenTimeoutMs: request.firstTokenTimeoutMs,
      idleTimeoutMs: request.idleTimeoutMs,
    })) {
      if (!frame.data || frame.data === '[DONE]') continue;
      let event: Record<string, any>;
      try { event = JSON.parse(frame.data); } catch { continue; }
      const type = text(event.type || frame.event);
      if (type === 'error' || type === 'response.failed') {
        const error = record(event.error ?? record(event.response).error);
        throw new ModelProviderError('MODEL_RESPONSES_ERROR', text(error.message || event.message || type), true, event);
      }
      if (type === 'response.output_text.delta') {
        const delta = text(event.delta);
        if (delta) { content += delta; await request.onContentDelta?.(delta); }
      } else if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') {
        const delta = text(event.delta);
        if (delta) { reasoning += delta; await request.onReasoningDelta?.(delta); }
      } else if (type === 'response.output_item.added') {
        const item = record(event.item);
        if (item.type === 'function_call') {
          const key = text(item.id || item.call_id) || String(event.output_index ?? itemIndexes.size);
          const index = Number(event.output_index ?? itemIndexes.size);
          itemIndexes.set(key, index);
          assembler.append({ index, id: text(item.call_id || item.id), name: text(item.name), argumentsDelta: text(item.arguments) });
        }
      } else if (type === 'response.function_call_arguments.delta') {
        const key = text(event.item_id || event.call_id);
        const index = itemIndexes.get(key) ?? Number(event.output_index ?? 0);
        assembler.append({ index, id: text(event.call_id || event.item_id), argumentsDelta: text(event.delta) });
      } else if (type === 'response.function_call_arguments.done') {
        const key = text(event.item_id || event.call_id);
        const index = itemIndexes.get(key) ?? Number(event.output_index ?? 0);
        assembler.append({ index, id: text(event.call_id || event.item_id), name: text(event.name), argumentsDelta: text(event.arguments) });
      } else if (type === 'response.completed') {
        const completed = record(event.response);
        usage = normalizeUsage(completed.usage);
        finishReason = 'stop';
      } else if (type === 'response.incomplete') {
        finishReason = 'length';
      }
    }
    const toolCalls = assembler.build(parseJsonObject);
    if (toolCalls.length) finishReason = 'tool_calls';
    if (finishReason === 'unknown') finishReason = 'stop';
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
}

function toResponseInput(message: AgentRuntimeMessage): Record<string, unknown> {
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: normalizeContent(message.content),
      tool_calls: message.toolCalls.map((call) => ({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: call.rawArguments || JSON.stringify(call.arguments ?? {}),
      })),
    };
  }
  if (message.role === 'tool') {
    return {
      type: 'function_call_output',
      call_id: message.toolCallId,
      output: normalizeContent(message.content),
    };
  }
  return { role: message.role, content: openAiResponseContent(message.content) };
}

function normalizeContent(value: unknown): string { return contentText(value); }

function normalizeUsage(value: unknown): ModelGenerationResult['usage'] {
  const usage = record(value);
  const inputDetails = record(usage.input_tokens_details);
  return {
    inputTokens: numeric(usage.input_tokens),
    outputTokens: numeric(usage.output_tokens),
    totalTokens: numeric(usage.total_tokens) ?? sum(numeric(usage.input_tokens), numeric(usage.output_tokens)),
    cachedInputTokens: numeric(inputDetails.cached_tokens),
  };
}
function numeric(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function sum(a?: number, b?: number): number | undefined { return a == null && b == null ? undefined : (a ?? 0) + (b ?? 0); }
