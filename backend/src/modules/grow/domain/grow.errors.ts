export class GrowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'GrowError';
  }
}

export class GrowInvariantError extends GrowError {
  constructor(code: string, message: string) {
    super(code, message, false);
    this.name = 'GrowInvariantError';
  }
}
