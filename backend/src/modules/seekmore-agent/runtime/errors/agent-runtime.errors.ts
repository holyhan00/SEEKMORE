export class AgentRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}

export class ModelProviderError extends AgentRuntimeError {
  constructor(code: string, message: string, retryable = false, details?: unknown) {
    super(code, message, retryable, details);
    this.name = 'ModelProviderError';
  }
}

export class ContextWindowExceededError extends ModelProviderError {
  constructor(message: string, details?: unknown) {
    super('MODEL_CONTEXT_WINDOW_EXCEEDED', message, true, details);
    this.name = 'ContextWindowExceededError';
  }
}
