import type { Socket } from 'socket.io-client';
import { FRONTEND_RUNTIME_CONFIG } from '../../../../runtime-config';
import { getDesktopRuntimeSnapshot } from '../../../../runtime/desktop/desktop-runtime.store';
import { getAuthToken } from '../../../../lib/auth-token';
import { getLocalizationSnapshot } from '../../../../localization/LocalizationProvider';

export interface SocketOptions {
  enabled?: boolean;
  autoReconnect?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

import type { ChatTurnSubmitPayload, StopChatTurnPayload } from './chat-turn-contracts';

export type SocketAuthSyncResult = {
  token: string | null;
  changed: boolean;
};

export type ResolvedSocketOptions = Required<Omit<SocketOptions, 'enabled'>>;

export const DEFAULT_SOCKET_OPTIONS: ResolvedSocketOptions = {
  autoReconnect: true,
  reconnectionAttempts: 6,
  reconnectionDelay: 2000,
};

export const WS_BASE_URL = resolveWebSocketBaseUrl();

export function resolveSocketOptions(options: SocketOptions = {}): ResolvedSocketOptions {
  return {
    autoReconnect: options.autoReconnect ?? DEFAULT_SOCKET_OPTIONS.autoReconnect,
    reconnectionAttempts: options.reconnectionAttempts ?? DEFAULT_SOCKET_OPTIONS.reconnectionAttempts,
    reconnectionDelay: options.reconnectionDelay ?? DEFAULT_SOCKET_OPTIONS.reconnectionDelay,
  };
}

export function buildSubmitTurnPayload(payload: ChatTurnSubmitPayload): ChatTurnSubmitPayload {
  return {
    ...payload,
    content: String(payload.content ?? ''),
    objectRefs: [...payload.objectRefs],
    localeContext: payload.localeContext ?? getLocalizationSnapshot(),
  };
}
export function buildStopTurnPayload(payload: StopChatTurnPayload): StopChatTurnPayload { return { ...payload }; }


export function syncSocketAuth(socket: Socket): SocketAuthSyncResult {
  const token = getAuthToken()?.trim() || null;
  const previousAuth = typeof socket.auth === 'object' && socket.auth !== null
    ? socket.auth as Record<string, unknown>
    : {};
  const previousToken = typeof previousAuth.token === 'string'
    ? previousAuth.token
    : typeof previousAuth.Authorization === 'string'
      ? previousAuth.Authorization.replace(/^Bearer\s+/i, '').trim()
      : null;
  const runtime = getDesktopRuntimeSnapshot();
  socket.auth = {
    clientType: runtime.isDesktop ? 'desktop' : 'web',
    version: '1.0.0',
    ...(token ? { token, Authorization: `Bearer ${token}` } : {}),
  };
  return { token, changed: previousToken !== token };
}

export function reconnectBackoff(base: number, attempt: number, cap = 15_000): number {
  return Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
}

export function logSocketRuntimeConfiguration(): void {
                                                  
                                                                  
                                                                              
                                          
                                           
     
}

function resolveWebSocketBaseUrl(): string {
  const runtimeWebSocketBaseUrl = String(
    FRONTEND_RUNTIME_CONFIG.websocketBaseUrl
    ?? '',
  ).trim();

  if (runtimeWebSocketBaseUrl) {
    return runtimeWebSocketBaseUrl
      .replace(/\/+$/, '');
  }

  return window.location.origin;
}