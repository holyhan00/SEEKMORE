import { useCallback, useEffect, useRef, useState } from 'react';
import { useRecoilCallback } from 'recoil';
import { io, type Socket } from 'socket.io-client';
import type { Message } from '../../../utils/types';
import { chatConversationTurnState, streamingCountState } from '../store/chatState';
import { reduceChatTurnState } from '../store/chat-turn-state.reducer';
import {
  attachChatDeliveryListeners,
  detachChatDeliveryListeners,
} from './socket/chat-delivery-listeners';
import type { ChatStreamState } from './socket/chat-stream-assembler';
import {
  attachSocketLifecycleListeners,
  detachSocketLifecycleListeners,
  type TransportOutboxItem,
} from './socket/socket-lifecycle-listeners';
import {
  approveRuntimeOperation,
  rejectRuntimeOperation,
  type RuntimeApprovalPayload,
} from './socket/runtime-approval-actions';
import {
  WS_BASE_URL,
  buildStopTurnPayload,
  buildSubmitTurnPayload,
  logSocketRuntimeConfiguration,
  resolveSocketOptions,
  syncSocketAuth,
  type SocketOptions,
} from './socket/socket-runtime';
import type {
  ChatTurnSubmitPayload,
  StopChatTurnAck,
  StopChatTurnPayload,
  SubmitChatTurnAck,
} from './socket/chat-turn-contracts';
import type { RuntimeApprovedDecision } from '../runtime/approval/runtimeApprovalClient';
import type { StreamFrameBatcher } from './socket/stream-frame-batcher';

let sharedSocket: Socket | null = null;
let sharedCleanupHeartbeat: (() => void) | null = null;
let subscribers = 0;

logSocketRuntimeConfiguration();

export const useSocket = (
  onReply: (message: Message) => void,
  onComplete: (id: string, conversationId?: string) => void,
  onRuntimeEvent?: (event: unknown) => void,
  onFailure?: (error: unknown) => void,
  options: SocketOptions = {},
) => {
  const [isConnected, setIsConnected] = useState(Boolean(sharedSocket?.connected));
  const [isInitialized, setIsInitialized] = useState(Boolean(sharedSocket));
  const optionsRef = useRef(resolveSocketOptions(options));
  const connectionEnabledRef = useRef(options.enabled !== false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());
  const userIdRef = useRef<string | null>(null);
  const onReplyRef = useRef(onReply);
  const onCompleteRef = useRef(onComplete);
  const onRuntimeEventRef = useRef(onRuntimeEvent);
  const onFailureRef = useRef(onFailure);
  const streamsRef = useRef<Record<string, ChatStreamState>>({});
  const deltaBatcherRef = useRef<StreamFrameBatcher<unknown> | null>(null);
  const transportOutboxRef = useRef<TransportOutboxItem[]>([]);
  const activeConversationIdRef = useRef<string | null>(null);
  const terminalTraceIdsRef = useRef(new Set<string>());

  useEffect(() => { onReplyRef.current = onReply; }, [onReply]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onRuntimeEventRef.current = onRuntimeEvent; }, [onRuntimeEvent]);
  useEffect(() => { onFailureRef.current = onFailure; }, [onFailure]);
  useEffect(() => {
    optionsRef.current = resolveSocketOptions(options);
    connectionEnabledRef.current = options.enabled !== false;
    if (connectionEnabledRef.current && sharedSocket && !sharedSocket.connected) {
      const auth = syncSocketAuth(sharedSocket);
      if (auth.token) sharedSocket.connect();
    }
  }, [options.autoReconnect, options.enabled, options.reconnectionAttempts, options.reconnectionDelay]);

  const bumpStreaming = useRecoilCallback(
    ({ set, snapshot }) => async (conversationId: string, delta: number) => {
      if (!conversationId) return;
      const current = await snapshot.getPromise(streamingCountState(conversationId));
      set(streamingCountState(conversationId), Math.max(0, (current ?? 0) + delta));
    },
    [],
  );

  const applyTurnEvent = useRecoilCallback(
    ({ set }) => (type: string, payload: unknown) => {
      const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      const conversationId = text(record.conversationId);
      if (!conversationId) return;
      set(chatConversationTurnState(conversationId), (current) => reduceChatTurnState(current, type, payload));
    },
    [],
  );

  const touch = useCallback(() => { lastActivityRef.current = Date.now(); }, []);
  const clearReconnectTimer = useCallback(() => {
    if (!reconnectTimerRef.current) return;
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);
  const setupHeartbeat = useCallback((socket: Socket) => {
    const interval = window.setInterval(() => {
      if (socket.connected && Date.now() - lastActivityRef.current > 25_000) socket.volatile.emit('ping');
    }, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  const attachDelivery = useCallback((socket: Socket) => {
    deltaBatcherRef.current?.dispose();
    deltaBatcherRef.current = attachChatDeliveryListeners({
      socket,
      streams: streamsRef.current,
      bumpStreaming,
      onReply: (message) => onReplyRef.current(message),
      onComplete: (id, conversationId) => onCompleteRef.current(id, conversationId),
      onFailure: (error) => onFailureRef.current?.(error),
      onRuntimeEvent: (event) => onRuntimeEventRef.current?.(event),
      touch,
      terminalTraceIds: terminalTraceIdsRef.current,
      onTurnEvent: applyTurnEvent,
    });
  }, [applyTurnEvent, bumpStreaming, touch]);

  const attachLifecycle = useCallback((socket: Socket) => {
    attachSocketLifecycleListeners({
      socket,
      optionsRef,
      reconnectAttemptRef,
      reconnectTimerRef,
      userIdRef,
      transportOutboxRef,
      activeConversationIdRef,
      streamsRef,
      bumpStreaming,
      clearReconnectTimer,
      setConnected: setIsConnected,
      setInitialized: setIsInitialized,
      touch,
    });
  }, [bumpStreaming, clearReconnectTimer, touch]);

  const ensureSocket = useCallback(() => {
    if (sharedSocket) {
      const socket = sharedSocket;
      const auth = syncSocketAuth(socket);
      attachDelivery(socket);
      attachLifecycle(socket);
      setIsInitialized(true);
      setIsConnected(socket.connected);
      if ((auth.changed || !auth.token) && socket.connected) socket.disconnect();
      if (connectionEnabledRef.current && auth.token && !socket.connected) socket.connect();
      return socket;
    }

    const socket = io(WS_BASE_URL, {
      autoConnect: false,
      reconnection: optionsRef.current.autoReconnect,
      reconnectionAttempts: optionsRef.current.reconnectionAttempts,
      reconnectionDelay: optionsRef.current.reconnectionDelay,
      reconnectionDelayMax: 15_000,
      timeout: 20_000,
      transports: ['websocket'],
      auth: {},
    });
    sharedSocket = socket;
    sharedCleanupHeartbeat = setupHeartbeat(socket);
    attachDelivery(socket);
    attachLifecycle(socket);
    setIsInitialized(true);
    const auth = syncSocketAuth(socket);
    if (connectionEnabledRef.current && auth.token) socket.connect();
    else console.warn('[ChatWS] connection deferred: missing access token', { url: WS_BASE_URL });
    return socket;
  }, [attachDelivery, attachLifecycle, setupHeartbeat]);

  useEffect(() => {
    subscribers += 1;
    const socket = ensureSocket();
    return () => {
      deltaBatcherRef.current?.dispose();
      deltaBatcherRef.current = null;
      subscribers -= 1;
      if (subscribers > 0) return;
      clearReconnectTimer();
      try { sharedCleanupHeartbeat?.(); } catch {                                       }
      sharedCleanupHeartbeat = null;
      detachChatDeliveryListeners(socket);
      detachSocketLifecycleListeners(socket);
      try { socket.removeAllListeners(); } catch {                                       }
      try { socket.io.removeAllListeners(); } catch {                                       }
      try { socket.close(); } catch {                                       }
      for (const item of transportOutboxRef.current) item.resolve({ ok: false, code: 'SOCKET_CLOSED', message: 'SOCKET_CLOSED' });
      transportOutboxRef.current = [];
      for (const key of Object.keys(streamsRef.current)) delete streamsRef.current[key];
      sharedSocket = null;
      setIsConnected(false);
      setIsInitialized(false);
    };
  }, [clearReconnectTimer, ensureSocket]);

  const emitAck = useCallback(<T,>(event: string, payload: unknown): Promise<T> => {
    const socket = ensureSocket();
    const auth = syncSocketAuth(socket);
    if (!auth.token) {
      return Promise.resolve({ ok: false, code: 'MISSING_ACCESS_TOKEN', message: 'MISSING_ACCESS_TOKEN' } as T);
    }
    return new Promise<T>((resolve) => {
      if (socket.connected) {
        socket.timeout(20_000).emit(event, payload, (error: unknown, ack: T) => {
          resolve(error ? ({ ok: false, code: 'TRANSPORT_ERROR', message: String(error) } as T) : ack);
        });
        touch();
      } else {
        transportOutboxRef.current.push({ event, payload, resolve });
        if (connectionEnabledRef.current) socket.connect();
      }
    });
  }, [ensureSocket, touch]);

  const submitTurn = useCallback((payload: ChatTurnSubmitPayload) => (
    emitAck<SubmitChatTurnAck>('chat.turn.submit', buildSubmitTurnPayload(payload))
  ), [emitAck]);
  const stopTurn = useCallback((payload: StopChatTurnPayload) => (
    emitAck<StopChatTurnAck>('chat.turn.stop', buildStopTurnPayload(payload))
  ), [emitAck]);
  const syncConversation = useCallback((conversationId: string) => {
    const id = text(conversationId);
    activeConversationIdRef.current = id || null;
    if (id) void emitAck('chat.turn.sync', { conversationId: id });
  }, [emitAck]);

  const approveRuntimeApproval = useCallback((payload: RuntimeApprovalPayload & { decision: RuntimeApprovedDecision }) => (
    approveRuntimeOperation(sharedSocket, payload, touch)
  ), [touch]);
  const rejectRuntimeApproval = useCallback((payload: RuntimeApprovalPayload & { decision?: 'rejected' }) => (
    rejectRuntimeOperation(sharedSocket, payload, touch)
  ), [touch]);

  const joinUserRoom = useCallback((userId: string) => {
    userIdRef.current = text(userId) || null;
    if (sharedSocket?.connected && userIdRef.current) sharedSocket.emit('join_user_room', { userId: userIdRef.current });
  }, []);

  return {
    submitTurn,
    stopTurn,
    syncConversation,
    isConnected,
    isInitialized,
    socket: sharedSocket,
    joinUserRoom,
    approveRuntimeApproval,
    rejectRuntimeApproval,
  };
};

function text(value: unknown): string { return String(value ?? '').trim(); }
