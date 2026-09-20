import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import {
  WS_BASE_URL,
  reconnectBackoff,
  type ResolvedSocketOptions,
  syncSocketAuth,
} from './socket-runtime';
import type { ChatStreamState } from './chat-stream-assembler';
import { refreshAccessToken } from '../../../../lib/http';

export type TransportOutboxItem = {
  event: string;
  payload: unknown;
  resolve(value: any): void;
};

type LifecycleOptions = {
  socket: Socket;
  optionsRef: MutableRefObject<ResolvedSocketOptions>;
  reconnectAttemptRef: MutableRefObject<number>;
  reconnectTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  userIdRef: MutableRefObject<string | null>;
  transportOutboxRef: MutableRefObject<TransportOutboxItem[]>;
  activeConversationIdRef: MutableRefObject<string | null>;
  streamsRef: MutableRefObject<Record<string, ChatStreamState>>;
  bumpStreaming(conversationId: string, delta: number): Promise<void>;
  clearReconnectTimer(): void;
  setConnected(value: boolean): void;
  setInitialized(value: boolean): void;
  touch(): void;
};

export function attachSocketLifecycleListeners(options: LifecycleOptions): void {
  const { socket } = options;
  detachSocketLifecycleListeners(socket);

  socket.io.on('reconnect_attempt', () => {
    syncSocketAuth(socket);
                                                                                                              
  });

  socket.on('connect', () => {
    options.clearReconnectTimer();
    options.setConnected(true);
    options.setInitialized(true);
    options.touch();
    options.reconnectAttemptRef.current = 0;
    syncSocketAuth(socket);
                                                                                                                 
    window.dispatchEvent(new Event('chat:socket:connected'));
    if (options.userIdRef.current) socket.emit('join_user_room', { userId: options.userIdRef.current });
    flushTransportOutbox(options);
    if (options.activeConversationIdRef.current) {
      socket.emit('chat.turn.sync', { conversationId: options.activeConversationIdRef.current });
    }
  });

  socket.on('disconnect', (reason) => {
    options.setConnected(false);
    const auth = syncSocketAuth(socket);
    console.warn('[ChatWS] disconnected', { reason, url: WS_BASE_URL, hasToken: Boolean(auth.token) });
    // Transport loss does not change the last observed Turn phase or cancellation target.
  });

  socket.on('connect_error', (error) => {
    options.setConnected(false);
    const auth = syncSocketAuth(socket);
    const attempt = ++options.reconnectAttemptRef.current;
    console.error('[ChatWS] connect_error', {
      url: WS_BASE_URL,
      message: error instanceof Error ? error.message : String(error),
      hasToken: Boolean(auth.token),
      attempt,
    });
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      void refreshSocketAuthentication(options);
      return;
    }
    scheduleFallbackReconnect(options, attempt, auth.token);
  });

  socket.on('auth_expired', () => {
    void refreshSocketAuthentication(options);
  });
}

export function detachSocketLifecycleListeners(socket: Socket): void {
  socket.off('connect');
  socket.off('disconnect');
  socket.off('connect_error');
  socket.off('auth_expired');
  socket.io.off('reconnect_attempt');
}

async function refreshSocketAuthentication(options: LifecycleOptions): Promise<void> {
  try {
    await refreshAccessToken();
    const auth = syncSocketAuth(options.socket);
    if (auth.token && !options.socket.connected) options.socket.connect();
  } catch {
    options.clearReconnectTimer();
  }
}

function flushTransportOutbox(options: LifecycleOptions): void {
  const queued = [...options.transportOutboxRef.current];
  options.transportOutboxRef.current = [];
  for (const item of queued) {
    options.socket.timeout(20_000).emit(item.event, item.payload, (error: unknown, ack: unknown) => {
      item.resolve(error ? { ok: false, code: 'TRANSPORT_ERROR', message: String(error) } : ack);
    });
    options.touch();
  }
}

function scheduleFallbackReconnect(options: LifecycleOptions, attempt: number, token: string | null): void {
  if (!options.optionsRef.current.autoReconnect) return;
  if (options.socket.active || options.reconnectTimerRef.current) return;
  if (attempt > options.optionsRef.current.reconnectionAttempts) {
    console.error('[ChatWS] reconnect attempts exhausted', {
      attempt,
      maxAttempts: options.optionsRef.current.reconnectionAttempts,
      url: WS_BASE_URL,
    });
    return;
  }
  if (!token) return;
  const delay = reconnectBackoff(options.optionsRef.current.reconnectionDelay, attempt);
  options.reconnectTimerRef.current = setTimeout(() => {
    options.reconnectTimerRef.current = null;
    const latest = syncSocketAuth(options.socket);
    if (!latest.token || options.socket.connected) return;
    options.socket.connect();
  }, delay);
}
