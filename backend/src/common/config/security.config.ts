export type SameSiteMode = 'lax' | 'strict' | 'none';
export const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function required(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInt(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function csv(name: string, fallback: string[] = []): string[] {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  return Array.from(new Set(raw.split(',').map((item) => item.trim()).filter(Boolean)));
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function jwtAccessConfig() {
  return {
    secret: required('JWT_ACCESS_SECRET'),
    issuer: String(process.env.JWT_ISSUER ?? 'seekmore').trim(),
    audience: String(process.env.JWT_AUDIENCE ?? 'seekmore-api').trim(),
    expiresIn: String(process.env.JWT_ACCESS_TTL ?? '15m').trim(),
  } as const;
}

export function jwtRefreshConfig() {
  return {
    secret: required('JWT_REFRESH_SECRET'),
    issuer: String(process.env.JWT_ISSUER ?? 'seekmore').trim(),
    audience: String(process.env.JWT_REFRESH_AUDIENCE ?? 'seekmore-refresh').trim(),
    expiresIn: '30d',
  } as const;
}

export function httpSecurityConfig() {
  const production = isProduction();
  const allowedOrigins = csv(
    'CORS_ALLOWED_ORIGINS',
    production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  );
  if (production && allowedOrigins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS is required in production');
  }
  return {
    allowedOrigins,
    jsonLimit: process.env.HTTP_JSON_LIMIT ?? '2mb',
    urlEncodedLimit: process.env.HTTP_URLENCODED_LIMIT ?? '1mb',
    port: positiveInt('PORT', 3000, 1, 65535),
    host: String(process.env.HOST ?? '0.0.0.0').trim(),
  } as const;
}

export function localIdentityConfig() {
  return {
    enabled:
      process.env.SEEKMORE_LOCAL_IDENTITY_ENABLED === 'true',
  } as const;
}

export function authCookieConfig() {
  const production = isProduction();
  const sameSiteRaw = String(process.env.AUTH_COOKIE_SAME_SITE ?? (production ? 'none' : 'lax')).trim().toLowerCase();
  const sameSite: SameSiteMode = sameSiteRaw === 'strict' || sameSiteRaw === 'none' ? sameSiteRaw : 'lax';
  return {
    name: String(process.env.AUTH_REFRESH_COOKIE_NAME ?? 'refreshToken').trim(),
    secure: production || process.env.AUTH_COOKIE_SECURE === 'true',
    sameSite,
    domain: String(process.env.AUTH_COOKIE_DOMAIN ?? '').trim() || undefined,
    path: String(process.env.AUTH_COOKIE_PATH ?? '/api/auth').trim() || '/api/auth',
    maxAgeMs: REFRESH_TOKEN_LIFETIME_MS,
  } as const;
}

export function toolRuntimeConfig() {
  return {
    queueLimit: positiveInt('TOOL_QUEUE_LIMIT', 128, 1, 10_000),
    queueTimeoutMs: positiveInt('TOOL_QUEUE_TIMEOUT_MS', 30_000, 100, 600_000),
    defaultTimeoutMs: positiveInt('TOOL_DEFAULT_TIMEOUT_MS', 120_000, 100, 3_600_000),
  } as const;
}

export function workspaceSecurityConfig() {
  return {
    allowedParents: csv('WORKSPACE_ALLOWED_PARENTS').map((item) => item.trim()).filter(Boolean),
  } as const;
}

export function localExecutionConfig() {
  return {
    enabled: process.env.SEEKMORE_LOCAL_EXECUTION_ENABLED !== 'false',
    sessionTtlMs: positiveInt('TERMINAL_SESSION_TTL_MS', 15 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
    maxCapturedChars: positiveInt('TERMINAL_MAX_CAPTURED_CHARS', 200_000, 10_000, 2_000_000),
  } as const;
}
