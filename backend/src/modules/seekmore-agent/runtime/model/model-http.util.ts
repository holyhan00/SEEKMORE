import { ContextWindowExceededError, ModelProviderError } from '../errors/agent-runtime.errors';
import { composeSignals, record, text } from '../util/runtime.util';

const responseCleanups = new WeakMap<Response, () => void>();

export async function postModelJson(input: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  totalTimeoutMs: number;
}): Promise<Response> {
  const composed = composeSignals([input.signal], input.totalTimeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(input.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream, application/json',
          ...input.headers,
        },
        body: JSON.stringify(input.body),
        signal: composed.signal,
      });
    } catch (error) {
      if (composed.signal.aborted) {
        const external = input.signal?.aborted;
        throw new ModelProviderError(
          external ? 'MODEL_CANCELLED' : 'MODEL_TOTAL_TIMEOUT',
          external ? 'Model request was cancelled' : 'Model request exceeded total timeout',
          !external,
          error,
        );
      }
      throw new ModelProviderError('MODEL_NETWORK_ERROR', error instanceof Error ? error.message : String(error), true, error);
    }
    if (!response.ok) {
      const body = await safeBody(response);
      const message = extractErrorMessage(body) || `Model provider returned HTTP ${response.status}`;
      if (isContextError(response.status, message)) {
        throw new ContextWindowExceededError(message, { status: response.status, body });
      }
      throw new ModelProviderError(
        `MODEL_HTTP_${response.status}`,
        message,
        response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500,
        { status: response.status, body, headers: Object.fromEntries(response.headers.entries()) },
      );
    }
    responseCleanups.set(response, composed.dispose);
    return response;
  } catch (error) {
    composed.dispose();
    throw error;
  }
}

export function bearerHeaders(apiKey?: string | null, extra?: Record<string, string>): Record<string, string> {
  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...(extra ?? {}),
  };
}

export function resolveChatCompletionsUrl(baseUrl?: string | null): string {
  const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

export function resolveResponsesUrl(baseUrl?: string | null): string {
  const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  if (/\/responses$/i.test(base)) return base;
  return `${base}/responses`;
}

export function resolveAnthropicUrl(baseUrl?: string | null): string {
  const base = String(baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  if (/\/messages$/i.test(base)) return base;
  return `${base}/messages`;
}

async function safeBody(response: Response): Promise<unknown> {
  const value = await response.text().catch(() => '');
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function extractErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  const root = record(value);
  const error = record(root.error);
  return text(error.message || root.message || error.error || root.detail);
}

function isContextError(status: number, message: string): boolean {
  if (status !== 400 && status !== 413 && status !== 422) return false;
  const value = message.toLowerCase();
  return value.includes('context length')
    || value.includes('maximum context')
    || value.includes('too many tokens')
    || value.includes('prompt is too long')
    || value.includes('context_window_exceeded');
}


export function releaseModelResponse(response: Response): void {
  const cleanup = responseCleanups.get(response);
  if (!cleanup) return;
  responseCleanups.delete(response);
  cleanup();
}

export type ModelHttpFailureKind =
  | 'TOOL_PROTOCOL_SEQUENCE'
  | 'CONTEXT_LIMIT'
  | 'INVALID_REQUEST'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'UNKNOWN';

export function classifyModelHttpFailure(
  error: unknown,
): ModelHttpFailureKind {
  if (error instanceof ContextWindowExceededError) {
    return 'CONTEXT_LIMIT';
  }

  const code = error instanceof ModelProviderError
    ? error.code
    : text(record(error).code);
  const message = error instanceof Error
    ? error.message
    : text(record(error).message);
  const normalizedCode = String(code ?? '').toUpperCase();
  const normalizedMessage = String(message ?? '').toLowerCase();

  if (
    normalizedCode === 'MODEL_HTTP_400'
    && isToolProtocolSequenceMessage(normalizedMessage)
  ) {
    return 'TOOL_PROTOCOL_SEQUENCE';
  }

  if (normalizedCode === 'MODEL_HTTP_401' || normalizedCode === 'MODEL_HTTP_403') {
    return 'AUTH';
  }
  if (normalizedCode === 'MODEL_HTTP_429') {
    return 'RATE_LIMIT';
  }
  if (/MODEL_HTTP_5\d\d/.test(normalizedCode)) {
    return 'SERVER';
  }
  if (normalizedCode === 'MODEL_HTTP_400' || normalizedCode === 'MODEL_HTTP_422') {
    return 'INVALID_REQUEST';
  }
  return 'UNKNOWN';
}

export function isToolProtocolSequenceError(
  error: unknown,
): boolean {
  return classifyModelHttpFailure(error) === 'TOOL_PROTOCOL_SEQUENCE';
}

function isToolProtocolSequenceMessage(message: string): boolean {
  if (!message) return false;
  return [
    /messages?.*role\s*['\"]?tool['\"]?.*(preceding|previous|response).*tool[_ ]calls?/i,
    /tool[_ ]call[_ ]id.*(missing|must|preceding|corresponding|not found|does not have|without)/i,
    /tool message.*(preceding|previous|corresponding).*tool[_ ]calls?/i,
    /function[_ ]call[_ ]output.*(preceding|corresponding|call[_ ]id)/i,
  ].some((pattern) => pattern.test(message));
}
