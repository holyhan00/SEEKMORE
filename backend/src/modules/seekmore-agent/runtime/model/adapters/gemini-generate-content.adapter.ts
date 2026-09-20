import { Injectable } from '@nestjs/common';
import type { AgentRuntimeMessage } from '../../../contracts/agent-turn.types';
import { ModelProviderError } from '../../errors/agent-runtime.errors';
import { postModelJson } from '../model-http.util';
import type { ModelGenerationRequest, ModelGenerationResult, ModelProviderAdapter } from '../model.types';
import { contentText, geminiParts } from '../model-content.util';
import { decodeSse } from '../stream/sse-decoder';
import { ToolCallStreamAssembler } from '../stream/tool-call-assembler';
import { hash, parseJsonObject, record, text } from '../../util/runtime.util';

@Injectable()
export class GeminiGenerateContentAdapter implements ModelProviderAdapter {
  readonly kind = 'gemini_generate_content';

  supports(route: { provider: string; apiMode?: string | null }): boolean {
    const provider = String(route.provider ?? '').toLowerCase();
    const mode = String(route.apiMode ?? '').toLowerCase();
    return provider === 'gemini' || provider === 'google' || mode === 'gemini_generate_content';
  }

  async generate(request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const base = String(request.route.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const encodedModel = encodeURIComponent(request.route.model.replace(/^models\//, ''));
    const url = `${base}/models/${encodedModel}:streamGenerateContent?alt=sse`;
    const system = request.messages.filter((m) => m.role === 'system').map((m) => contentText(m.content)).filter(Boolean).join('\n\n');
    const body: Record<string, unknown> = {
      contents: toGeminiContents(request.messages.filter((m) => m.role !== 'system')),
      generationConfig: {
        ...(request.temperature != null ? { temperature: request.temperature } : {}),
        ...(request.maxTokens != null ? { maxOutputTokens: request.maxTokens } : {}),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (request.tools.length) {
      body.tools = [{ functionDeclarations: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })) }];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }

    const response = await postModelJson({
      url,
      headers: {
        'x-goog-api-key': request.route.apiKey ?? '',
        ...(request.route.headers ?? {}),
      },
      body,
      signal: request.signal,
      totalTimeoutMs: request.totalTimeoutMs,
    });

    const assembler = new ToolCallStreamAssembler();
    let content = '';
    let reasoning = '';
    let finishReason: ModelGenerationResult['finishReason'] = 'unknown';
    let usage: ModelGenerationResult['usage'] = {};
    let callIndex = 0;

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
        throw new ModelProviderError('MODEL_GEMINI_ERROR', text(error.message || payload.error), true, payload.error);
      }
      const candidate = record(Array.isArray(payload.candidates) ? payload.candidates[0] : null);
      const candidateContent = record(candidate.content);
      for (const rawPart of (Array.isArray(candidateContent.parts) ? candidateContent.parts : [])) {
        const part = record(rawPart);
        if (typeof part.text === 'string') {
          if (part.thought === true) {
            reasoning += part.text;
            await request.onReasoningDelta?.(part.text);
          } else {
            content += part.text;
            await request.onContentDelta?.(part.text);
          }
        }
        if (part.functionCall) {
          const call = record(part.functionCall);
          const name = text(call.name);
          assembler.set({
            index: callIndex++,
            id: text(call.id) || `gemini_${hash(`${name}:${JSON.stringify(call.args ?? {})}:${callIndex}`, 16)}`,
            name,
            arguments: call.args ?? {},
          });
        }
      }
      if (candidate.finishReason) finishReason = normalizeFinish(candidate.finishReason);
      if (payload.usageMetadata) usage = normalizeUsage(payload.usageMetadata);
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

function toGeminiContents(messages: AgentRuntimeMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    let next: Record<string, unknown>;
    if (message.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      const value = contentText(message.content);
      if (value) parts.push({ text: value });
      for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.arguments } });
      next = { role: 'model', parts };
    } else if (message.role === 'tool') {
      next = { role: 'user', parts: [{ functionResponse: { name: message.name, response: parseToolResponse(message.content) } }] };
    } else {
      next = { role: 'user', parts: geminiParts(message.content) };
    }
    const previous = output.at(-1);
    if (
      previous &&
      previous.role === next.role &&
      Array.isArray(previous.parts) &&
      Array.isArray(next.parts)
    ) {
      previous.parts = [...previous.parts, ...next.parts];
    } else {
      output.push(next);
    }
  }
  return output;
}

function parseToolResponse(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  const raw = contentText(value);
  try { const parsed = JSON.parse(raw); return record(parsed); } catch { return { content: raw }; }
}
function normalizeFinish(value: unknown): ModelGenerationResult['finishReason'] { const reason = text(value).toUpperCase(); if (reason === 'STOP') return 'stop'; if (reason === 'MAX_TOKENS') return 'length'; if (reason === 'SAFETY' || reason === 'RECITATION') return 'content_filter'; return 'unknown'; }
function normalizeUsage(value: unknown): ModelGenerationResult['usage'] { const usage = record(value); return { inputTokens: numeric(usage.promptTokenCount), outputTokens: numeric(usage.candidatesTokenCount), totalTokens: numeric(usage.totalTokenCount), cachedInputTokens: numeric(usage.cachedContentTokenCount) }; }
function numeric(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
