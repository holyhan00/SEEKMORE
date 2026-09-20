import type { McpRuntimeConfig } from '../domain/mcp-runtime.types';

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listEnv(name: string): string[] {
  const value = process.env[name];
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

export function loadMcpRuntimeConfig(): McpRuntimeConfig {
  return {
    enabled: booleanEnv('MCP_RUNTIME_ENABLED', true),
    clientName: process.env.MCP_RUNTIME_CLIENT_NAME || 'seekmore-mcp-runtime',
    clientVersion: process.env.MCP_RUNTIME_CLIENT_VERSION || '1.0.0',
    defaultTimeoutMs: numberEnv('MCP_RUNTIME_DEFAULT_TIMEOUT_MS', 30000),
    maxResultBytes: numberEnv('MCP_RUNTIME_MAX_RESULT_BYTES', 1048576),
    maxOAuthStateSeconds: numberEnv('MCP_RUNTIME_MAX_OAUTH_STATE_SECONDS', 600),
    stdioCommandAllowlist: listEnv('MCP_RUNTIME_STDIO_COMMAND_ALLOWLIST'),
    oauthRedirectBaseUrl: String(
      process.env.MCP_RUNTIME_OAUTH_REDIRECT_BASE_URL ??
        'http://127.0.0.1:3000/mcp-runtime/oauth',
    ).trim().replace(/\/+$/, ''),
  };
}
