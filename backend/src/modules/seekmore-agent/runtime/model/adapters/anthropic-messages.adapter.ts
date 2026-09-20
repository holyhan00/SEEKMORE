import { Injectable } from '@nestjs/common';
import type { AgentRuntimeMessage } from '../../../contracts/agent-turn.types';
import { ModelProviderError } from '../../errors/agent-runtime.errors';
import { postModelJson, resolveAnthropicUrl } from '../model-http.util';
import type { ModelGenerationRequest, ModelGenerationResult, ModelProviderAdapter } from '../model.types';
import { anthropicContent, contentText } from '../model-content.util';
import { decodeSse } from '../stream/sse-decoder';
import { ToolCallStreamAssembler } from '../stream/tool-call-assembler';
import { parseJsonObject, record, text } from '../../util/runtime.util';

@Injectable()
export class AnthropicMessagesAdapter implements ModelProviderAdapter {
  readonly kind = 'anthropic_messages';

  supports(route: { provider: string; apiMode?: string | null; baseUrl?: string | null }): boolean {
    const provider = String(route.provider ?? '').toLowerCase();
    const mode = String(route.apiMode ?? '').toLowerCase();
    return provider === 'anthropic' || provider === 'claude' || mode === 'anthropic_messages';
  }

  async generate(request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const { system, messages } = toAnthropicMessages(request.messages);
    const body: Record<string, unknown> = {
      model: request.route.model,
      messages,
      max_tokens: request.maxTokens ?? 8192,
      stream: true,
    };
    if (system) body.system = system;
    if (request.temperature != null) body.temperature = request.temperature;
    if (request.tools.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    }
    if (request.reasoningEffort && request.reasoningEffort !== 'none') {
      const budget = request.reasoningEffort === 'high' ? 16000 : request.reasoningEffort === 'medium' ? 8000 : 4000;
      body.thinking = { type: 'enabled', budget_tokens: budget };
    }

    const response = await postModelJson({
      url: resolveAnthropicUrl(request.route.baseUrl),
      headers: {
        'x-api-key': request.route.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        ...(request.route.headers ?? {}),
      },
      body,
      signal: request.signal,
      totalTimeoutMs: request.totalTimeoutMs,
    });

    const assembler = new ToolCallStreamAssembler();
    const blockTypes = new Map<number, string>();
    let content = '';
    let reasoning = '';
    let finishReason: ModelGenerationResult['finishReason'] = 'unknown';
    let usage: ModelGenerationResult['usage'] = {};

    for await (const frame of decodeSse(response, {
      signal: request.signal,
      firstTokenTimeoutMs: request.firstTokenTimeoutMs,
      idleTimeoutMs: request.idleTimeoutMs,
    })) {
      if (!frame.data || frame.data === '[DONE]') continue;
      let event: Record<string, any>;
      try { event = JSON.parse(frame.data); } catch { continue; }
      const type = text(event.type || frame.event);
      if (type === 'error') {
        const error = record(event.error);
        throw new ModelProviderError('MODEL_ANTHROPIC_ERROR', text(error.message || event.error), true, event);
      }
      if (type === 'message_start') {
        const message = record(event.message);
        usage = { ...usage, inputTokens: numeric(record(message.usage).input_tokens) };
      } else if (type === 'content_block_start') {
        const index = Number(event.index ?? 0);
        const block = record(event.content_block);
        blockTypes.set(index, text(block.type));
        if (block.type === 'text') {
          const delta = text(block.text);
          if (delta) { content += delta; await request.onContentDelta?.(delta); }
        } else if (block.type === 'thinking') {
          const delta = text(block.thinking);
          if (delta) { reasoning += delta; await request.onReasoningDelta?.(delta); }
        } else if (block.type === 'tool_use') {
          assembler.set({ index, id: text(block.id), name: text(block.name), arguments: block.input ?? {} });
        }
      } else if (type === 'content_block_delta') {
        const index = Number(event.index ?? 0);
        const delta = record(event.delta);
        if (delta.type === 'text_delta') {
          const value = text(delta.text);
          if (value) { content += value; await request.onContentDelta?.(value); }
        } else if (delta.type === 'thinking_delta' || delta.type === 'signature_delta') {
          const value = text(delta.thinking);
          if (value) { reasoning += value; await request.onReasoningDelta?.(value); }
        } else if (delta.type === 'input_json_delta') {
          assembler.append({ index, argumentsDelta: text(delta.partial_json) });
        }
      } else if (type === 'message_delta') {
        const delta = record(event.delta);
        finishReason = normalizeStopReason(delta.stop_reason);
        usage = { ...usage, outputTokens: numeric(record(event.usage).output_tokens) };
      } else if (type === 'message_stop' && finishReason === 'unknown') {
        finishReason = assembler.build(parseJsonObject).length ? 'tool_calls' : 'stop';
      }
    }
    const toolCalls = assembler.build(parseJsonObject);
    if (toolCalls.length) finishReason = 'tool_calls';
    if (finishReason === 'unknown') finishReason = 'stop';
    usage.totalTokens = sum(usage.inputTokens, usage.outputTokens);
    return {
      provider: request.route.provider,
      model: request.route.model,
      content,
      reasoning,
      toolCalls,
      finishReason,
      usage,
      metadata: { adapter: this.kind, blockTypes: Object.fromEntries(blockTypes) },
    };
  }
}

function toAnthropicMessages(messages: AgentRuntimeMessage[]): { system: string; messages: Array<Record<string, unknown>> } {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => contentText(message.content))
    .filter(Boolean)
    .join('\n\n');
  const output: Array<Record<string, unknown>> = [];
  for (const message of messages.filter((item) => item.role !== 'system')) {
    let next: Record<string, unknown>;
    if (message.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      const value = contentText(message.content);
      if (value) blocks.push({ type: 'text', text: value });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      next = { role: 'assistant', content: blocks };
    } else if (message.role === 'tool') {
      next = {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: contentText(message.content),
          is_error: contentText(message.content).includes('"status":"failed"'),
        }],
      };
    } else {
      next = { role: 'user', content: anthropicContent(message.content) };
    }
    const previous = output.at(-1);
    if (
      previous &&
      previous.role === next.role &&
      Array.isArray(previous.content) &&
      Array.isArray(next.content)
    ) {
      previous.content = [...previous.content, ...next.content];
    } else {
      output.push(next);
    }
  }
  return { system, messages: output };
}


function normalizeStopReason(value: unknown): ModelGenerationResult['finishReason'] {
  const reason = text(value);
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'max_tokens') return 'length';
  return 'unknown';
}
function numeric(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function sum(a?: number, b?: number): number | undefined { return a == null && b == null ? undefined : (a ?? 0) + (b ?? 0); }
