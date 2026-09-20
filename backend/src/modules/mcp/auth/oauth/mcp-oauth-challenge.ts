export interface McpOAuthChallenge {
  status: number;
  scheme: 'Bearer';
  error?: string;
  errorDescription?: string;
  resourceMetadata?: string;
  scopes: string[];
  raw: string;
}

export function parseMcpOAuthChallenge(
  header: string | null | undefined,
  status: number,
): McpOAuthChallenge | null {
  const raw = String(header ?? '').trim();
  if (!raw) return null;

  const bearerMatch = /(?:^|,)\s*Bearer\b/i.exec(raw);
  if (!bearerMatch) return null;

  const offset = (bearerMatch.index ?? 0) + bearerMatch[0].length;
  const params = parseAuthParams(raw.slice(offset));

  return {
    status,
    scheme: 'Bearer',
    error: clean(params.error),
    errorDescription: clean(params.error_description),
    resourceMetadata: clean(params.resource_metadata),
    scopes: normalizeScopes(params.scope),
    raw,
  };
}

export function normalizeScopes(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/\s+/)
      : [];

  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort();
}

export function unionScopes(...values: unknown[]): string[] {
  return normalizeScopes(
    values.flatMap((value) =>
      Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(/\s+/)
          : [],
    ),
  );
}

function parseAuthParams(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const expression = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(value))) {
    const key = match[1].toLowerCase();
    const quoted = match[2];
    const unquoted = match[3];
    result[key] = quoted !== undefined
      ? quoted.replace(/\\([\\"])/g, '$1')
      : String(unquoted ?? '');
  }

  return result;
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
