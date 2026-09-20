import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import { FRONTEND_RUNTIME_CONFIG } from '../runtime-config';
import {
  getAuthToken,
  setAuthToken,
} from './auth-token';

export {
  getAuthToken,
  setAuthToken,
} from './auth-token';

export const API_BASE_URL =
  FRONTEND_RUNTIME_CONFIG.backendOrigin;
export const API_PREFIX = '/api';
const AXIOS_BASE_URL =
  FRONTEND_RUNTIME_CONFIG.apiBaseUrl;

export const api = axios.create({
  baseURL: AXIOS_BASE_URL,
  timeout: 600_000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

function stampMeta(config: any) {
  const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now =
    globalThis.performance?.now?.()
    ?? Date.now();

  config.__meta = {
    rid,
    start: now,
  };

  return config;
}

function elapsed(config: any) {
  const now =
    globalThis.performance?.now?.()
    ?? Date.now();

  return Math.max(
    0,
    Math.round(
      now
      - (config?.__meta?.start ?? now),
    ),
  );
}

function isSessionEndpoint(
  url: unknown,
): boolean {
  const path = String(url ?? '');

  return [
    '/auth/local-session',
    '/auth/refresh',
  ].some(
    (endpoint) =>
      path.includes(endpoint),
  );
}

api.interceptors.request.use(
  (config) => {
    const token = getAuthToken();

    config.headers =
      config.headers || {};

    if (token) {
      config.headers.Authorization =
        `Bearer ${token}`;
    }

    return stampMeta(config);
  },
);

let refreshPromise:
  | Promise<string>
  | null = null;

let localSessionPromise:
  | Promise<string>
  | null = null;

export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{
        access_token?: string;
      }>(
        `${AXIOS_BASE_URL}/auth/refresh`,
        {},
        {
          withCredentials: true,
          timeout: 30_000,
        },
      )
      .then(({ data }) => {
        const token = String(
          data?.access_token ?? '',
        ).trim();

        if (!token) {
          throw new Error(
            'AUTH_REFRESH_ACCESS_TOKEN_MISSING',
          );
        }

        setAuthToken(token);
        return token;
      })
      .catch((error) => {
        setAuthToken(null);
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export function ensureLocalSession(): Promise<string> {
  if (!localSessionPromise) {
    localSessionPromise = axios
      .post<{
        access_token?: string;
      }>(
        `${AXIOS_BASE_URL}/auth/local-session`,
        {},
        {
          withCredentials: true,
          timeout: 30_000,
        },
      )
      .then(({ data }) => {
        const token = String(
          data?.access_token ?? '',
        ).trim();

        if (!token) {
          throw new Error(
            'LOCAL_SESSION_ACCESS_TOKEN_MISSING',
          );
        }

        setAuthToken(token);
        return token;
      })
      .catch((error) => {
        setAuthToken(null);
        throw error;
      })
      .finally(() => {
        localSessionPromise = null;
      });
  }

  return localSessionPromise;
}

export async function recoverLocalSession(): Promise<string> {
  try {
    return await refreshAccessToken();
  } catch {
    return ensureLocalSession();
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (
      InternalAxiosRequestConfig & {
        _authRetried?: boolean;
        __meta?: unknown;
      }
    ) | undefined;

    const status =
      error.response?.status;

    if (
      status === 401
      && config
      && !config._authRetried
      && !isSessionEndpoint(
        config.url,
      )
    ) {
      config._authRetried = true;

      try {
        const token =
          await recoverLocalSession();

        config.headers.Authorization =
          `Bearer ${token}`;

        return api.request(config);
      } catch {
      }
    }

    (error as any).__meta = {
      rid:
        (config as any)
          ?.__meta?.rid,
      ms: elapsed(config),
      status,
    };

    return Promise.reject(error);
  },
);

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const execute = (
    token: string | null,
  ) => {
    const headers =
      new Headers(init.headers);

    if (token) {
      headers.set(
        'Authorization',
        `Bearer ${token}`,
      );
    }

    return fetch(input, {
      ...init,
      headers,
      credentials: 'include',
    });
  };

  let response = await execute(
    getAuthToken(),
  );

  if (
    response.status === 401
    && !isSessionEndpoint(
      String(input),
    )
  ) {
    try {
      const token =
        await recoverLocalSession();

      response =
        await execute(token);
    } catch {
    }
  }

  return response;
}

export function getAbsoluteApiUrl(
  path: string,
) {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  const url = path.startsWith(
    API_PREFIX,
  )
    ? path
    : `${API_PREFIX}${path}`;

  return FRONTEND_RUNTIME_CONFIG.backendOrigin
    ? `${FRONTEND_RUNTIME_CONFIG.backendOrigin}${url}`
    : url;
}
