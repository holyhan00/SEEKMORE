let accessToken: string | null = null;

type TokenListener = (token: string | null) => void;
const listeners = new Set<TokenListener>();

export function getAuthToken(): string | null {
  return accessToken;
}

export function setAuthToken(token: string | null): void {
  accessToken = token?.trim() || null;
  for (const listener of listeners) listener(accessToken);
}

export function subscribeAuthToken(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
