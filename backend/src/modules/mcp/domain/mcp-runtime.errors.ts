export class McpRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpRuntimeError';
  }
}

export class McpSecurityPolicyError extends McpRuntimeError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}
