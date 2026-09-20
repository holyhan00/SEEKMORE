import { Injectable } from '@nestjs/common';
import type { LLMResolvedConfig } from '../llm-registry.port';
import type {
  LLMChatMessage,
  LLMNativeToolCall,
  LLMNativeToolDecision,
  LLMNativeToolDefinition,
} from '../llm-client.types';

type ProviderInput = {
  config: LLMResolvedConfig;
  messages: LLMChatMessage[];
  tools?: LLMNativeToolDefinition[];
  signal?: AbortSignal;
};

type SseFrame = {
  event: string | null;
  data: string;
};

class LlmProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`LLM provider request failed: HTTP ${status}${responseBody ? ` ${responseBody.slice(0, 500)}` : ''}`);
  }
}

@Injectable()
export class LlmProviderClientService {
  async stream(input: ProviderInput & { onDelta: (chunk: string) => void }): Promise<void> {
    const protocol = this.protocol(input.config);
    if (protocol === 'anthropic_messages') return this.streamAnthropic(input);
    if (protocol === 'gemini_generate_content') return this.streamGemini(input);
    if (protocol === 'openai_responses') return this.streamOpenAiResponses(input);
    return this.streamOpenAiChat(input);
  }

  async chat(input: ProviderInput): Promise<string> {
    const result = await this.complete(input);
    return result.content;
  }

  async chatWithTools(input: ProviderInput & { tools: LLMNativeToolDefinition[] }): Promise<LLMNativeToolDecision> {
    if (input.config.supportsTools === false) throw new Error('LLM_MODEL_NOT_AGENT_COMPATIBLE');
    return this.complete(input);
  }

  private complete(input: ProviderInput): Promise<LLMNativeToolDecision> {
    const protocol = this.protocol(input.config);
    if (protocol === 'anthropic_messages') return this.completeAnthropic(input);
    if (protocol === 'gemini_generate_content') return this.completeGemini(input);
    if (protocol === 'openai_responses') return this.completeOpenAiResponses(input);
    return this.completeOpenAiChat(input);
  }

  private protocol(config: LLMResolvedConfig): 'openai_chat' | 'openai_responses' | 'anthropic_messages' | 'gemini_generate_content' {
    const mode = String(config.apiMode ?? '').toLowerCase();
    const provider = String(config.provider ?? '').toLowerCase();
    if (mode === 'responses' || mode === 'codex_responses' || mode === 'responses_basic_tools') {
      return 'openai_responses';
    }
    if (mode === 'anthropic_messages' || provider === 'anthropic' || provider === 'claude') return 'anthropic_messages';
    if (mode === 'gemini_generate_content' || provider === 'gemini' || provider === 'google') return 'gemini_generate_content';
    return 'openai_chat';
  }

  private async streamOpenAiChat(input: ProviderInput & { onDelta: (chunk: string) => void }): Promise<void> {
    const body = this.openAiChatBody(input, true);
    const response = await this.postOpenAiChatWithThinkingFallback(input.config, body, input.signal);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      const payload = await this.readJson(response);
      const content = this.openAiChatContent(payload);
      if (content) input.onDelta(content);
      return;
    }

    for await (const frame of this.decodeSse(response, input.signal)) {
      if (!frame.data || frame.data === '[DONE]') continue;
      const payload = this.tryJson(frame.data);
      if (!payload) continue;
      if (payload.error) this.throwStreamError(payload);
      const choice = this.record(this.array(payload.choices)[0]);
      const delta = this.record(choice.delta);
      const content = this.contentText(delta.content);
      if (content) input.onDelta(content);
    }
  }

  private async completeOpenAiChat(input: ProviderInput): Promise<LLMNativeToolDecision> {
    const body = this.openAiChatBody(input, false);
    const response = await this.postOpenAiChatWithThinkingFallback(input.config, body, input.signal);
    const payload = await this.readJson(response);
    const choice = this.record(this.array(payload.choices)[0]);
    const message = this.record(choice.message);
    return {
      content: this.contentText(message.content),
      toolCalls: this.openAiToolCalls(message.tool_calls),
      finishReason: choice.finish_reason ? String(choice.finish_reason) : null,
    };
  }

  private openAiChatBody(input: ProviderInput, stream: boolean): Record<string, unknown> {
    const config = input.config;
    const toolMode = this.openAiToolMode(config);
    const body: Record<string, unknown> = {
      model: config.model,
      messages: this.withSystemPrompt(input.messages, config.systemPrompt).map((message) => this.toOpenAiMessage(message)),
      stream: toolMode === 'nonstream' && input.tools?.length ? false : stream,
      ...this.normalizedExtra(config.extra),
    };

    if (input.tools?.length) {
      body.tools = input.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description ?? tool.name,
          parameters: tool.parameters,
        },
      }));
      if (toolMode === 'full') {
        body.tool_choice = 'auto';
        body.parallel_tool_calls = true;
      }
    }

    const thinking = this.deepSeekThinking(config);
    if (thinking) {
      body.thinking = { type: thinking };
      if (thinking === 'enabled') {
        body.reasoning_effort = config.thinking?.reasoningEffort ?? 'high';
        delete body.temperature;
        delete body.top_p;
      }
    }

    if (!thinking || thinking === 'disabled') {
      if (config.supportsTemperature !== false && typeof config.temperature === 'number') {
        body.temperature = config.temperature;
      }
      if (config.supportsTemperature !== false && typeof config.top_p === 'number') {
        body.top_p = config.top_p;
      }
    }

    return body;
  }

  private openAiToolMode(config: LLMResolvedConfig): 'full' | 'basic' | 'nonstream' {
    const mode = String(config.apiMode ?? '').toLowerCase();
    if (mode === 'chat_completions_nonstream_tools') return 'nonstream';
    if (mode === 'chat_completions_basic_tools') return 'basic';
    return 'full';
  }

  private async postOpenAiChatWithThinkingFallback(
    config: LLMResolvedConfig,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.postJson({
        url: this.chatCompletionsUrl(config.baseUrl),
        headers: this.bearerHeaders(config),
        body,
        signal,
      });
    } catch (error) {
      if (!(error instanceof LlmProviderHttpError)) throw error;
      if (!this.shouldRetryDeepSeekWithoutThinking(config, body, error.status)) throw error;
      const fallback: Record<string, unknown> = { ...body, thinking: { type: 'disabled' } };
      delete fallback.reasoning_effort;
      return this.postJson({
        url: this.chatCompletionsUrl(config.baseUrl),
        headers: this.bearerHeaders(config),
        body: fallback,
        signal,
      });
    }
  }

  private async streamOpenAiResponses(input: ProviderInput & { onDelta: (chunk: string) => void }): Promise<void> {
    const response = await this.postJson({
      url: this.responsesUrl(input.config.baseUrl),
      headers: this.bearerHeaders(input.config),
      body: this.openAiResponsesBody(input, true),
      signal: input.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      const payload = await this.readJson(response);
      const content = this.responsesContent(payload);
      if (content) input.onDelta(content);
      return;
    }

    for await (const frame of this.decodeSse(response, input.signal)) {
      if (!frame.data || frame.data === '[DONE]') continue;
      const payload = this.tryJson(frame.data);
      if (!payload) continue;
      const type = String(payload.type ?? frame.event ?? '');
      if (type === 'error' || payload.error) this.throwStreamError(payload);
      if (type === 'response.output_text.delta') {
        const delta = String(payload.delta ?? '');
        if (delta) input.onDelta(delta);
      }
    }
  }

  private async completeOpenAiResponses(input: ProviderInput): Promise<LLMNativeToolDecision> {
    const response = await this.postJson({
      url: this.responsesUrl(input.config.baseUrl),
      headers: this.bearerHeaders(input.config),
      body: this.openAiResponsesBody(input, false),
      signal: input.signal,
    });
    const payload = await this.readJson(response);
    const toolCalls: LLMNativeToolCall[] = [];
    for (const raw of this.array(payload.output)) {
      const item = this.record(raw);
      if (String(item.type ?? '') !== 'function_call') continue;
      const name = String(item.name ?? '').trim();
      if (!name) continue;
      toolCalls.push({
        id: String(item.call_id ?? item.id ?? `tool_${toolCalls.length + 1}`),
        name,
        arguments: this.parseArguments(item.arguments),
      });
    }
    return {
      content: this.responsesContent(payload),
      toolCalls,
      finishReason: toolCalls.length ? 'tool_calls' : String(payload.status ?? 'completed'),
    };
  }

  private openAiResponsesBody(input: ProviderInput, stream: boolean): Record<string, unknown> {
    const messages = this.withSystemPrompt(input.messages, input.config.systemPrompt);
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .filter(Boolean)
      .join('\n\n');
    const body: Record<string, unknown> = {
      model: input.config.model,
      input: this.toResponsesInput(messages.filter((message) => message.role !== 'system')),
      stream,
      ...this.normalizedExtra(input.config.extra),
    };
    if (system) body.instructions = system;
    if (input.tools?.length) {
      const basicTools = String(input.config.apiMode ?? '').toLowerCase() === 'responses_basic_tools';
      body.tools = input.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description ?? tool.name,
        parameters: tool.parameters,
        ...(!basicTools ? { strict: false } : {}),
      }));
      if (!basicTools) {
        body.tool_choice = 'auto';
        body.parallel_tool_calls = true;
      }
    }
    if (input.config.supportsTemperature !== false && typeof input.config.temperature === 'number') {
      body.temperature = input.config.temperature;
    }
    if (input.config.thinking?.reasoningEffort) {
      body.reasoning = { effort: input.config.thinking.reasoningEffort };
    }
    return body;
  }

  private async streamAnthropic(input: ProviderInput & { onDelta: (chunk: string) => void }): Promise<void> {
    const response = await this.postJson({
      url: this.anthropicUrl(input.config.baseUrl),
      headers: this.anthropicHeaders(input.config),
      body: this.anthropicBody(input, true),
      signal: input.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      const payload = await this.readJson(response);
      const content = this.anthropicContent(payload);
      if (content) input.onDelta(content);
      return;
    }

    for await (const frame of this.decodeSse(response, input.signal)) {
      if (!frame.data) continue;
      const payload = this.tryJson(frame.data);
      if (!payload) continue;
      const type = String(payload.type ?? frame.event ?? '');
      if (type === 'error' || payload.error) this.throwStreamError(payload);
      if (type !== 'content_block_delta') continue;
      const delta = this.record(payload.delta);
      if (String(delta.type ?? '') !== 'text_delta') continue;
      const text = String(delta.text ?? '');
      if (text) input.onDelta(text);
    }
  }

  private async completeAnthropic(input: ProviderInput): Promise<LLMNativeToolDecision> {
    const response = await this.postJson({
      url: this.anthropicUrl(input.config.baseUrl),
      headers: this.anthropicHeaders(input.config),
      body: this.anthropicBody(input, false),
      signal: input.signal,
    });
    const payload = await this.readJson(response);
    const toolCalls: LLMNativeToolCall[] = [];
    for (const raw of this.array(payload.content)) {
      const block = this.record(raw);
      if (String(block.type ?? '') !== 'tool_use') continue;
      const name = String(block.name ?? '').trim();
      if (!name) continue;
      toolCalls.push({
        id: String(block.id ?? `tool_${toolCalls.length + 1}`),
        name,
        arguments: this.record(block.input),
      });
    }
    return {
      content: this.anthropicContent(payload),
      toolCalls,
      finishReason: payload.stop_reason ? String(payload.stop_reason) : null,
    };
  }

  private anthropicBody(input: ProviderInput, stream: boolean): Record<string, unknown> {
    const messages = this.withSystemPrompt(input.messages, input.config.systemPrompt);
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .filter(Boolean)
      .join('\n\n');
    const body: Record<string, unknown> = {
      model: input.config.model,
      max_tokens: 4096,
      messages: this.toAnthropicMessages(messages.filter((message) => message.role !== 'system')),
      stream,
    };
    if (system) body.system = system;
    if (input.tools?.length) {
      body.tools = input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? tool.name,
        input_schema: tool.parameters,
      }));
      body.tool_choice = { type: 'auto' };
    }
    if (input.config.supportsTemperature !== false && typeof input.config.temperature === 'number') {
      body.temperature = input.config.temperature;
    }
    return body;
  }

  private async streamGemini(input: ProviderInput & { onDelta: (chunk: string) => void }): Promise<void> {
    const response = await this.postJson({
      url: this.geminiUrl(input.config, true),
      headers: this.geminiHeaders(input.config),
      body: this.geminiBody(input),
      signal: input.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      const payload = await this.readJson(response);
      const content = this.geminiContent(payload);
      if (content) input.onDelta(content);
      return;
    }

    for await (const frame of this.decodeSse(response, input.signal)) {
      if (!frame.data || frame.data === '[DONE]') continue;
      const payload = this.tryJson(frame.data);
      if (!payload) continue;
      if (payload.error) this.throwStreamError(payload);
      const content = this.geminiContent(payload);
      if (content) input.onDelta(content);
    }
  }

  private async completeGemini(input: ProviderInput): Promise<LLMNativeToolDecision> {
    const response = await this.postJson({
      url: this.geminiUrl(input.config, false),
      headers: this.geminiHeaders(input.config),
      body: this.geminiBody(input),
      signal: input.signal,
    });
    const payload = await this.readJson(response);
    const candidate = this.record(this.array(payload.candidates)[0]);
    const content = this.record(candidate.content);
    const toolCalls: LLMNativeToolCall[] = [];
    for (const raw of this.array(content.parts)) {
      const part = this.record(raw);
      const call = this.record(part.functionCall);
      const name = String(call.name ?? '').trim();
      if (!name) continue;
      toolCalls.push({
        id: String(call.id ?? `gemini_${toolCalls.length + 1}`),
        name,
        arguments: this.record(call.args),
      });
    }
    return {
      content: this.geminiContent(payload),
      toolCalls,
      finishReason: candidate.finishReason ? String(candidate.finishReason) : null,
    };
  }

  private geminiBody(input: ProviderInput): Record<string, unknown> {
    const messages = this.withSystemPrompt(input.messages, input.config.systemPrompt);
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .filter(Boolean)
      .join('\n\n');
    const generationConfig: Record<string, unknown> = {};
    if (input.config.supportsTemperature !== false && typeof input.config.temperature === 'number') {
      generationConfig.temperature = input.config.temperature;
    }
    if (input.config.supportsTemperature !== false && typeof input.config.top_p === 'number') {
      generationConfig.topP = input.config.top_p;
    }

    const body: Record<string, unknown> = {
      contents: this.toGeminiContents(messages.filter((message) => message.role !== 'system')),
      generationConfig,
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (input.tools?.length) {
      body.tools = [{
        functionDeclarations: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? tool.name,
          parameters: tool.parameters,
        })),
      }];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }
    return body;
  }

  private withSystemPrompt(messages: LLMChatMessage[], systemPrompt?: string): LLMChatMessage[] {
    const normalized = messages.map((message) => ({
      ...message,
      content: String(message.content ?? ''),
    }));
    const prompt = String(systemPrompt ?? '').trim();
    if (!prompt || normalized.some((message) => message.role === 'system')) return normalized;
    return [{ role: 'system', content: prompt }, ...normalized];
  }

  private toOpenAiMessage(message: LLMChatMessage): Record<string, unknown> {
    const output: Record<string, unknown> = {
      role: message.role,
      content: message.content,
    };
    if (message.name) output.name = message.name;
    if (message.tool_call_id) output.tool_call_id = message.tool_call_id;
    if (message.tool_calls?.length) output.tool_calls = message.tool_calls;
    return output;
  }

  private toResponsesInput(messages: LLMChatMessage[]): Array<Record<string, unknown>> {
    const output: Array<Record<string, unknown>> = [];
    for (const message of messages) {
      if (message.role === 'tool') {
        output.push({
          type: 'function_call_output',
          call_id: message.tool_call_id ?? message.name ?? `tool_${output.length + 1}`,
          output: message.content,
        });
        continue;
      }
      output.push({ role: message.role, content: message.content });
      if (message.role === 'assistant') {
        for (const raw of message.tool_calls ?? []) {
          const call = this.record(raw);
          const fn = this.record(call.function);
          const name = String(fn.name ?? call.name ?? '').trim();
          if (!name) continue;
          output.push({
            type: 'function_call',
            call_id: String(call.id ?? `tool_${output.length + 1}`),
            name,
            arguments: typeof fn.arguments === 'string'
              ? fn.arguments
              : JSON.stringify(fn.arguments ?? call.arguments ?? {}),
          });
        }
      }
    }
    return output;
  }

  private toAnthropicMessages(messages: LLMChatMessage[]): Array<Record<string, unknown>> {
    const output: Array<Record<string, unknown>> = [];
    for (const message of messages) {
      let next: Record<string, unknown>;
      if (message.role === 'assistant') {
        const content: Array<Record<string, unknown>> = [];
        if (message.content) content.push({ type: 'text', text: message.content });
        for (const raw of message.tool_calls ?? []) {
          const call = this.record(raw);
          const fn = this.record(call.function);
          const name = String(fn.name ?? call.name ?? '').trim();
          if (!name) continue;
          content.push({
            type: 'tool_use',
            id: String(call.id ?? `tool_${content.length + 1}`),
            name,
            input: this.parseArguments(fn.arguments ?? call.arguments),
          });
        }
        next = { role: 'assistant', content };
      } else if (message.role === 'tool') {
        next = {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: message.tool_call_id ?? message.name ?? `tool_${output.length + 1}`,
            content: message.content,
          }],
        };
      } else {
        next = { role: 'user', content: [{ type: 'text', text: message.content }] };
      }
      this.mergeAdjacentMessage(output, next, 'content');
    }
    return output;
  }

  private toGeminiContents(messages: LLMChatMessage[]): Array<Record<string, unknown>> {
    const output: Array<Record<string, unknown>> = [];
    for (const message of messages) {
      let next: Record<string, unknown>;
      if (message.role === 'assistant') {
        const parts: Array<Record<string, unknown>> = [];
        if (message.content) parts.push({ text: message.content });
        for (const raw of message.tool_calls ?? []) {
          const call = this.record(raw);
          const fn = this.record(call.function);
          const name = String(fn.name ?? call.name ?? '').trim();
          if (!name) continue;
          parts.push({ functionCall: { name, args: this.parseArguments(fn.arguments ?? call.arguments) } });
        }
        next = { role: 'model', parts };
      } else if (message.role === 'tool') {
        next = {
          role: 'user',
          parts: [{
            functionResponse: {
              name: message.name ?? message.tool_call_id ?? 'tool',
              response: this.parseToolResponse(message.content),
            },
          }],
        };
      } else {
        next = { role: 'user', parts: [{ text: message.content }] };
      }
      this.mergeAdjacentMessage(output, next, 'parts');
    }
    return output;
  }

  private mergeAdjacentMessage(
    output: Array<Record<string, unknown>>,
    next: Record<string, unknown>,
    contentKey: 'content' | 'parts',
  ): void {
    const previous = output.at(-1);
    if (
      previous
      && previous.role === next.role
      && Array.isArray(previous[contentKey])
      && Array.isArray(next[contentKey])
    ) {
      previous[contentKey] = [
        ...(previous[contentKey] as unknown[]),
        ...(next[contentKey] as unknown[]),
      ];
      return;
    }
    output.push(next);
  }

  private openAiToolCalls(value: unknown): LLMNativeToolCall[] {
    const output: LLMNativeToolCall[] = [];
    for (const raw of this.array(value)) {
      const call = this.record(raw);
      const fn = this.record(call.function);
      const name = String(fn.name ?? '').trim();
      if (!name) continue;
      output.push({
        id: String(call.id ?? `tool_${output.length + 1}`),
        name,
        arguments: this.parseArguments(fn.arguments),
      });
    }
    return output;
  }

  private responsesContent(payload: Record<string, any>): string {
    if (typeof payload.output_text === 'string') return payload.output_text;
    const values: string[] = [];
    for (const raw of this.array(payload.output)) {
      const item = this.record(raw);
      if (String(item.type ?? '') !== 'message') continue;
      for (const rawContent of this.array(item.content)) {
        const content = this.record(rawContent);
        if (String(content.type ?? '') === 'output_text' && typeof content.text === 'string') {
          values.push(content.text);
        }
      }
    }
    return values.join('');
  }

  private openAiChatContent(payload: Record<string, any>): string {
    const choice = this.record(this.array(payload.choices)[0]);
    return this.contentText(this.record(choice.message).content);
  }

  private anthropicContent(payload: Record<string, any>): string {
    return this.array(payload.content)
      .map((raw) => this.record(raw))
      .filter((block) => String(block.type ?? '') === 'text')
      .map((block) => String(block.text ?? ''))
      .join('');
  }

  private geminiContent(payload: Record<string, any>): string {
    const candidate = this.record(this.array(payload.candidates)[0]);
    const content = this.record(candidate.content);
    return this.array(content.parts)
      .map((raw) => this.record(raw))
      .filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => String(part.text))
      .join('');
  }

  private async postJson(input: {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(input.url, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...input.headers,
        },
        body: JSON.stringify(input.body),
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) throw new Error('ABORTED');
      throw error instanceof Error ? error : new Error(String(error ?? 'LLM provider request failed'));
    }
    if (response.ok) return response;
    const body = await response.text().catch(() => '');
    throw new LlmProviderHttpError(response.status, this.providerErrorMessage(body));
  }

  private async readJson(response: Response): Promise<Record<string, any>> {
    const raw = await response.text();
    if (!raw) return {};
    const payload = this.tryJson(raw);
    if (!payload) throw new Error('LLM_PROVIDER_INVALID_JSON_RESPONSE');
    return payload;
  }

  private async *decodeSse(response: Response, signal?: AbortSignal): AsyncGenerator<SseFrame> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        if (signal?.aborted) throw new Error('ABORTED');
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const rawFrame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const frame = this.parseSseFrame(rawFrame);
          if (frame) yield frame;
          boundary = buffer.indexOf('\n\n');
        }
      }
      buffer += decoder.decode();
      const finalFrame = this.parseSseFrame(buffer);
      if (finalFrame) yield finalFrame;
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  private parseSseFrame(raw: string): SseFrame | null {
    const lines = raw.split('\n');
    const data: string[] = [];
    let event: string | null = null;
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim() || null;
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return null;
    return { event, data: data.join('\n') };
  }

  private bearerHeaders(config: LLMResolvedConfig): Record<string, string> {
    if (!config.apiKey) throw new Error('NO_API_KEY');
    return {
      authorization: `Bearer ${config.apiKey}`,
      ...(config.org ? { 'OpenAI-Organization': config.org } : {}),
      ...(config.headers ?? {}),
    };
  }

  private anthropicHeaders(config: LLMResolvedConfig): Record<string, string> {
    if (!config.apiKey) throw new Error('NO_API_KEY');
    return {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      ...(config.headers ?? {}),
    };
  }

  private geminiHeaders(config: LLMResolvedConfig): Record<string, string> {
    if (!config.apiKey) throw new Error('NO_API_KEY');
    return {
      'x-goog-api-key': config.apiKey,
      ...(config.headers ?? {}),
    };
  }

  private chatCompletionsUrl(baseUrl?: string): string {
    const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
  }

  private responsesUrl(baseUrl?: string): string {
    const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return /\/responses$/i.test(base) ? base : `${base}/responses`;
  }

  private anthropicUrl(baseUrl?: string): string {
    const base = String(baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    if (/\/messages$/i.test(base)) return base;
    return /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
  }

  private geminiUrl(config: LLMResolvedConfig, stream: boolean): string {
    const base = String(config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const model = encodeURIComponent(config.model.replace(/^models\//, ''));
    return `${base}/models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  }

  private deepSeekThinking(config: LLMResolvedConfig): 'enabled' | 'disabled' | null {
    if (config.providerKey !== 'deepseek' && config.provider !== 'deepseek') return null;
    if (config.thinking?.enabled === false || config.thinking?.type === 'disabled') return 'disabled';
    return 'enabled';
  }

  private shouldRetryDeepSeekWithoutThinking(
    config: LLMResolvedConfig,
    body: Record<string, unknown>,
    status: number,
  ): boolean {
    const thinking = this.record(body.thinking);
    return (config.providerKey === 'deepseek' || config.provider === 'deepseek')
      && thinking.type === 'enabled'
      && status >= 400
      && status < 500;
  }

  private normalizedExtra(extra?: Record<string, any>): Record<string, unknown> {
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {};
    const cloned: Record<string, unknown> = { ...extra };
    const extraBody = this.record(cloned.extra_body);
    if (Object.keys(extraBody).length) {
      Object.assign(cloned, extraBody);
      delete cloned.extra_body;
    }
    return cloned;
  }

  private contentText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === 'string') return item;
        const record = this.record(item);
        return String(record.text ?? record.content ?? '');
      }).join('');
    }
    if (value == null) return '';
    const record = this.record(value);
    return String(record.text ?? record.content ?? '');
  }

  private parseArguments(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    const raw = String(value ?? '{}');
    try {
      const parsed = JSON.parse(raw);
      return this.record(parsed);
    } catch {
      return { __invalidJson: raw };
    }
  }

  private parseToolResponse(value: string): Record<string, unknown> {
    try {
      return this.record(JSON.parse(value));
    } catch {
      return { content: value };
    }
  }

  private throwStreamError(payload: Record<string, any>): never {
    const error = this.record(payload.error);
    const message = String(error.message ?? payload.message ?? error.code ?? 'LLM provider stream error');
    throw new Error(message);
  }

  private providerErrorMessage(raw: string): string {
    if (!raw) return '';
    const parsed = this.tryJson(raw);
    if (!parsed) return raw.slice(0, 500);
    const error = this.record(parsed.error);
    return String(error.message ?? error.code ?? parsed.message ?? parsed.detail ?? raw).slice(0, 500);
  }

  private tryJson(value: string): Record<string, any> | null {
    try {
      const parsed = JSON.parse(value);
      return this.record(parsed);
    } catch {
      return null;
    }
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {};
  }

  private array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }
}
