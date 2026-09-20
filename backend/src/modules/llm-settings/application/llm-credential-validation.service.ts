import { Injectable } from '@nestjs/common';
import type {
  LlmCredentialValidationResult,
  LlmCatalogModel,
  LlmCatalogProvider,
  LlmModelRole,
  LlmProviderProtocol,
} from '../contracts/llm-settings.types';

const VALIDATION_TIMEOUT_MS = 15_000;

@Injectable()
export class LlmCredentialValidationService {
  async validate(input: {
    provider: LlmCatalogProvider;
    model: LlmCatalogModel;
    apiKey: string;
    role?: LlmModelRole;
  }): Promise<LlmCredentialValidationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
    (timer as unknown as { unref?: () => void }).unref?.();

    try {
      const request = this.probeRequest(input.provider, input.model, input.apiKey, input.role ?? 'primary');
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        signal: controller.signal,
      });
      const body = await response.text().catch(() => '');
      return this.fromResponse(response.status, body);
    } catch (error) {
      return {
        status: 'UNAVAILABLE',
        code: error instanceof Error && error.name === 'AbortError'
          ? 'LLM_PROVIDER_VALIDATION_TIMEOUT'
          : 'LLM_PROVIDER_UNAVAILABLE',
        verifiedAt: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private probeRequest(
    provider: LlmCatalogProvider,
    model: LlmCatalogModel,
    apiKey: string,
    role: LlmModelRole,
  ): {
    method: 'GET' | 'POST';
    url: string;
    headers: Record<string, string>;
    body?: Record<string, unknown>;
  } {
    const protocol: LlmProviderProtocol = model.protocol ?? provider.protocol;
    const base = (model.baseUrl ?? provider.baseUrl).replace(/\/+$/, '');

    if (role === 'image_generation') {
      if (protocol === 'gemini_image' || protocol === 'gemini_interactions_image') {
        const encodedModel = encodeURIComponent(model.modelKey.replace(/^models\//, ''));
        return {
          method: 'GET',
          url: `${base}/models/${encodedModel}`,
          headers: { 'x-goog-api-key': apiKey },
        };
      }
      if (protocol === 'dashscope_multimodal_image' || protocol === 'ark_images') {
        const catalogBase = provider.baseUrl.replace(/\/+$/, '');
        return {
          method: 'GET',
          url: `${catalogBase}/models`,
          headers: { authorization: `Bearer ${apiKey}` },
        };
      }
      return {
        method: 'GET',
        url: `${base}/models/${encodeURIComponent(model.modelKey)}`,
        headers: { authorization: `Bearer ${apiKey}` },
      };
    }

    const requireTools = role === 'primary';
    const prompt = requireTools
      ? 'Call the seekmore_connection_check tool with ok=true. Do not answer with text.'
      : 'Reply with OK.';
    const toolSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    };

    if (protocol === 'anthropic_messages') {
      return {
        method: 'POST',
        url: /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model: model.modelKey,
          max_tokens: 64,
          messages: [{ role: 'user', content: prompt }],
          ...(requireTools ? {
            tools: [{
              name: 'seekmore_connection_check',
              description: 'Validate that the selected model supports Agent tool calls.',
              input_schema: toolSchema,
            }],
            tool_choice: { type: 'tool', name: 'seekmore_connection_check' },
          } : {}),
        },
      };
    }

    if (protocol === 'gemini_generate_content') {
      const encodedModel = encodeURIComponent(model.modelKey.replace(/^models\//, ''));
      return {
        method: 'POST',
        url: `${base}/models/${encodedModel}:generateContent`,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 64 },
          ...(requireTools ? {
            tools: [{
              functionDeclarations: [{
                name: 'seekmore_connection_check',
                description: 'Validate that the selected model supports Agent tool calls.',
                parameters: toolSchema,
              }],
            }],
            toolConfig: {
              functionCallingConfig: {
                mode: 'ANY',
                allowedFunctionNames: ['seekmore_connection_check'],
              },
            },
          } : {}),
        },
      };
    }

    if (protocol === 'openai_responses' || ['responses', 'responses_basic_tools'].includes(model.apiMode)) {
      const basicTools = model.apiMode === 'responses_basic_tools';
      const body: Record<string, unknown> = {
        model: model.modelKey,
        input: prompt,
        max_output_tokens: 64,
      };
      if (requireTools) {
        body.tools = [{
          type: 'function',
          name: 'seekmore_connection_check',
          description: 'Validate that the selected model supports Agent tool calls.',
          parameters: toolSchema,
          ...(!basicTools ? { strict: false } : {}),
        }];
        if (!basicTools) body.tool_choice = 'auto';
      }
      return {
        method: 'POST',
        url: /\/responses$/i.test(base) ? base : `${base}/responses`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body,
      };
    }

    const body: Record<string, unknown> = {
      model: model.modelKey,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };
    if (requireTools) {
      body.tools = [{
        type: 'function',
        function: {
          name: 'seekmore_connection_check',
          description: 'Validate that the selected model supports Agent tool calls.',
          parameters: toolSchema,
        },
      }];
      if (!['chat_completions_basic_tools', 'chat_completions_nonstream_tools'].includes(model.apiMode)) {
        body.tool_choice = 'auto';
      }
    }

    return {
      method: 'POST',
      url: /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body,
    };
  }

  private fromResponse(status: number, rawBody: string): LlmCredentialValidationResult {
    const now = new Date();
    if (status >= 200 && status < 300) {
      return { status: 'VALID', code: 'LLM_CONNECTION_OK', verifiedAt: now };
    }
    const message = this.errorMessage(rawBody).toLowerCase();
    if (status === 401 || this.isAuthenticationError(message)) {
      return { status: 'INVALID', code: 'LLM_API_KEY_INVALID', verifiedAt: null };
    }
    if (status === 403 && this.isModelAccessError(message)) {
      return { status: 'INVALID', code: 'LLM_MODEL_NOT_ACCESSIBLE', verifiedAt: null };
    }
    if (status === 403) {
      return { status: 'INVALID', code: 'LLM_API_KEY_FORBIDDEN', verifiedAt: null };
    }
    if (status === 402) {
      return { status: 'VALID', code: 'LLM_PROVIDER_PAYMENT_REQUIRED', verifiedAt: now };
    }
    if (status === 429) {
      return { status: 'RATE_LIMITED', code: 'LLM_PROVIDER_RATE_LIMITED', verifiedAt: now };
    }

    if (status === 404 || this.isModelAccessError(message)) {
      return { status: 'INVALID', code: 'LLM_MODEL_NOT_ACCESSIBLE', verifiedAt: null };
    }
    if (this.isToolCompatibilityError(message)) {
      return { status: 'INVALID', code: 'LLM_MODEL_NOT_AGENT_COMPATIBLE', verifiedAt: null };
    }
    if (this.isPaymentError(message)) {
      return { status: 'VALID', code: 'LLM_PROVIDER_PAYMENT_REQUIRED', verifiedAt: now };
    }
    if (status >= 500) {
      return { status: 'UNAVAILABLE', code: 'LLM_PROVIDER_UNAVAILABLE', verifiedAt: null };
    }
    return {
      status: 'UNAVAILABLE',
      code: `LLM_PROVIDER_VALIDATION_HTTP_${status}`,
      verifiedAt: null,
    };
  }

  private errorMessage(rawBody: string): string {
    if (!rawBody) return '';
    try {
      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      const error = payload.error && typeof payload.error === 'object'
        ? payload.error as Record<string, unknown>
        : {};
      return String(error.message ?? error.code ?? payload.message ?? payload.detail ?? rawBody);
    } catch {
      return rawBody;
    }
  }

  private isAuthenticationError(message: string): boolean {
    return [
      'invalid api key',
      'invalid_api_key',
      'authentication',
      'unauthorized',
      'incorrect api key',
      'api key not valid',
    ].some((value) => message.includes(value));
  }

  private isModelAccessError(message: string): boolean {
    const mentionsModel = message.includes('model');
    const inaccessible = [
      'not found',
      'does not exist',
      'not available',
      'not accessible',
      'no access',
      'permission',
      'unsupported model',
      'unknown model',
    ].some((value) => message.includes(value));
    return mentionsModel && inaccessible;
  }

  private isToolCompatibilityError(message: string): boolean {
    const mentionsToolProtocol = [
      'tool',
      'function call',
      'function_call',
      'function declaration',
      'function_declaration',
    ].some((value) => message.includes(value));
    const unsupported = [
      'not supported',
      'unsupported',
      'not available',
      'invalid tool_choice',
      'unknown field',
      'unrecognized field',
    ].some((value) => message.includes(value));
    return mentionsToolProtocol && unsupported;
  }

  private isPaymentError(message: string): boolean {
    return [
      'insufficient balance',
      'insufficient credit',
      'billing',
      'payment required',
      'quota exceeded',
      'recharge',
    ].some((value) => message.includes(value));
  }
}
