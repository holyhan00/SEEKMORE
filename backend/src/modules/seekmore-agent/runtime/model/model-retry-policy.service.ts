import { Injectable } from '@nestjs/common';
import { AgentRuntimeError, ContextWindowExceededError, ModelProviderError } from '../errors/agent-runtime.errors';

@Injectable()
export class ModelRetryPolicyService {
  maximumAttempts(): number {
    return Math.max(1, Math.min(Number(process.env.SEEKMORE_AGENT_MODEL_RETRY_ATTEMPTS ?? 3), 6));
  }

  shouldRetry(error: unknown, attempt: number): boolean {
    if (error instanceof ContextWindowExceededError) return false;
    if (error instanceof AgentRuntimeError) return error.retryable && attempt < this.maximumAttempts();
    return attempt < this.maximumAttempts();
  }

  delayMs(error: unknown, attempt: number): number {
    const base = error instanceof ModelProviderError && error.code === 'MODEL_HTTP_429' ? 2000 : 500;
    const ceiling = Math.min(30_000, base * 2 ** Math.max(0, attempt - 1));
    return Math.round(ceiling * (0.75 + Math.random() * 0.5));
  }
}
