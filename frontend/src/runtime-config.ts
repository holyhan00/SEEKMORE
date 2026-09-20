type FrontendRuntimeConfig = {
  apiBaseUrl: string;
  backendOrigin: string;
  websocketBaseUrl: string;
};

type FrontendRuntimeConfigInput = {
  env?: Record<string, unknown>;
  location?: Pick<Location, 'protocol' | 'origin' | 'search'> | null;
};

const env = (import.meta as any)?.env ?? {};
const browserLocation = typeof window !== 'undefined'
  ? window.location
  : null;

function normalize(value: unknown): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

export function resolveFrontendRuntimeConfig(
  input: FrontendRuntimeConfigInput,
): FrontendRuntimeConfig {
  const runtimeEnv = input.env ?? {};
  const location = input.location ?? null;
  const browserOrigin = location && /^https?:$/i.test(location.protocol)
    ? normalize(location.origin)
    : '';
  const desktopBackendOrigin = resolveDesktopBackendOrigin(location);

  const configuredApiBaseUrl = normalize(runtimeEnv.VITE_API_BASE_URL);
  const configuredBackendOrigin = normalize(
    runtimeEnv.VITE_BACKEND_BASE_URL
      ?? runtimeEnv.VITE_PUBLIC_BACKEND_BASE_URL,
  );
  const configuredWebsocketBaseUrl = normalize(runtimeEnv.VITE_WS_BASE_URL);

  const apiBaseUrl = desktopBackendOrigin
    ? `${desktopBackendOrigin}/api`
    : configuredApiBaseUrl
      || (browserOrigin ? `${browserOrigin}/api` : '/api');

  const backendOrigin = desktopBackendOrigin
    || configuredBackendOrigin
    || inferBackendOrigin(apiBaseUrl, browserOrigin);

  return Object.freeze({
    apiBaseUrl,
    backendOrigin,
    websocketBaseUrl:
      desktopBackendOrigin
      || configuredWebsocketBaseUrl
      || backendOrigin
      || browserOrigin,
  });
}

function resolveDesktopBackendOrigin(
  location: FrontendRuntimeConfigInput['location'],
): string {
  if (!location) return '';

  const params = new URLSearchParams(location.search ?? '');
  if (params.get('seekmoreRuntime') !== 'desktop') return '';

  const value = normalize(params.get('backendOrigin'));
  if (!value) return '';

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'http:'
      || parsed.hostname !== '127.0.0.1'
      || !parsed.port
    ) {
      return '';
    }
    return parsed.origin;
  } catch {
    return '';
  }
}

function inferBackendOrigin(
  apiBaseUrl: string,
  browserOrigin: string,
): string {
  try {
    const parsed = browserOrigin
      ? new URL(apiBaseUrl, browserOrigin)
      : new URL(apiBaseUrl);
    return parsed.origin === 'null' ? '' : parsed.origin;
  } catch {
    return browserOrigin;
  }
}

export const FRONTEND_RUNTIME_CONFIG: FrontendRuntimeConfig =
  resolveFrontendRuntimeConfig({
    env,
    location: browserLocation,
  });
