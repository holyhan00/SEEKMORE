                                                                       
import type { Socket } from 'socket.io-client';
import type { Message } from '../../../../utils/types';
import {
  createChatPayloadAssembler,
  mergeChatDeltaPayload,
  projectChatTurnMessageEnvelopes,
  type ChatStreamState,
} from './chat-stream-assembler';
import {
  createStreamFrameBatcher,
  type StreamFrameBatcher,
} from './stream-frame-batcher';

const DELIVERY_EVENTS = [
  'chat.response.delta',
  'chat.turn.objects',
  'chat.response.completed',
  'chat.response.failed',
  'chat.turn.started',
  'chat.turn.input',
  'chat.turn.accepted',
  'chat.turn.cancel_requested',
  'chat.turn.cancelled',
  'chat.queue.snapshot',
  'chat.queue.updated',
  'runtime_event',
  'workflow:changed',
  'automation.changed',
  'automation.message',
  'automation.message.hidden',
  'runtime_settings_updated',
  'CHAT_TITLE_CREATED',
  'CHAT_TITLE_UPDATED',
] as const;

export type ChatDeliveryListenerOptions = {
  socket: Socket;
  streams: Record<string, ChatStreamState>;
  bumpStreaming(conversationId: string, delta: number): Promise<void>;
  onReply(message: Message): void;
  onComplete(id: string, conversationId?: string): void;
  onFailure?(error: unknown): void;
  onRuntimeEvent?(event: unknown): void;
  touch(): void;
  terminalTraceIds: Set<string>;
  onTurnEvent(type: string, payload: unknown): void;
};

export function attachChatDeliveryListeners(
  options: ChatDeliveryListenerOptions,
): StreamFrameBatcher<unknown> {
  const { socket } = options;
  detachChatDeliveryListeners(socket);

  socket.on('runtime_event', (event: unknown) => {
    options.touch();
    try {
      options.onRuntimeEvent?.(event);
    } catch (error) {
      console.error('[ChatWS] runtime event handler failed', {
        error: messageOf(error),
      });
    }
  });

  socket.on('workflow:changed', (payload: unknown) => {
    options.touch();
    dispatchWindowEvent('chat:workflow:changed', payload);
  });

  socket.on('automation.changed', (payload: unknown) => {
    options.touch();
    dispatchWindowEvent('chat:automation:changed', payload);
  });

  socket.on('automation.message', (payload: unknown) => {
    options.touch();
    const record = objectRecord(payload);
    const message = objectRecord(record.message);
    const id = text(message.id);
    const conversationId = text(message.conversationId);
    if (!id || !conversationId) return;
    options.onReply({
      ...message,
      id,
      conversationId,
      role: 'agent',
      content: String(message.content ?? ''),
      timestamp: Number(message.timestamp ?? Date.now()),
      is_complete: true,
    } as unknown as Message);
  });

  socket.on('automation.message.hidden', (payload: unknown) => {
    options.touch();
    dispatchWindowEvent('chat:automation:message-hidden', payload);
  });

  socket.on('runtime_settings_updated', (payload: unknown) => {
    options.touch();
    dispatchWindowEvent('chat:runtime-settings-updated', payload);
  });

  socket.on('CHAT_TITLE_CREATED', (payload: unknown) => {
    dispatchWindowEvent('chat:title:created', payload);
    options.touch();
  });

  socket.on('CHAT_TITLE_UPDATED', (payload: unknown) => {
    dispatchWindowEvent('chat:title:updated', payload);
    options.touch();
  });

  const assembler = createChatPayloadAssembler({
    streams: options.streams,
    bumpStreaming: options.bumpStreaming,
    onReply: options.onReply,
    onComplete: options.onComplete,
    touch: options.touch,
  });

  const frameBatcher =
    createStreamFrameBatcher<unknown>({
      keyOf: requestKey,
      merge: mergeChatDeltaPayload,
      consume: (data) =>
        assembler.assemble(data, 'delta'),
    });

  const batcher: StreamFrameBatcher<unknown> = {
    enqueue: (value) =>
      frameBatcher.enqueue(value),
    flushKey: (key) =>
      frameBatcher.flushKey(key),
    discardKey: (key) => {
      frameBatcher.discardKey(key);
      assembler.discard(key);
    },
    dispose: () => {
      frameBatcher.dispose();
      assembler.dispose();
    },
  };

  socket.on('chat.response.delta', (data: unknown) => {
    if (
      options.terminalTraceIds.has(
        requestKey(data),
      )
    ) {
      return;
    }

    batcher.enqueue(data);
  });

  socket.on('chat.turn.objects', (data: unknown) => {
    if (
      options.terminalTraceIds.has(
        requestKey(data),
      )
    ) {
      return;
    }

    void assembler.assemble(
      data,
      'objects',
    );
  });

  socket.on('chat.response.completed', (data: unknown) => {
    void (async () => {
      if (
        options.terminalTraceIds.has(
          requestKey(data),
        )
      ) {
        return;
      }

      if (!isAutomationTurnPayload(data)) {
        options.onTurnEvent(
          'chat.response.completed',
          data,
        );
      }

      options.terminalTraceIds.add(
        requestKey(data),
      );

      await batcher.flushKey(
        requestKey(data),
      );

      await assembler.assemble(
        data,
        'completed',
      );
    })();
  });

  socket.on('chat.turn.started', (data: unknown) => {
      
                                                     
                                             
                                                            
       
    void assembler.assemble(
      data,
      'started',
    );

    if (!isAutomationTurnPayload(data)) {
      options.onTurnEvent(
        'chat.turn.started',
        data,
      );
    }
  });

  for (
    const event of [
      'chat.turn.input',
  'chat.turn.accepted',
      'chat.turn.cancel_requested',
          'chat.queue.snapshot',
      'chat.queue.updated',
    ] as const
  ) {
    socket.on(
      event,
      (data: unknown) =>
        options.onTurnEvent(
          event,
          data,
        ),
    );
  }

  socket.on('chat.turn.cancelled', (data: unknown) => {
    void (async () => {
      const requestId =
        requestKey(data);

      if (
        options.terminalTraceIds.has(
          requestId,
        )
      ) {
        return;
      }

      options.terminalTraceIds.add(
        requestId,
      );

      batcher.discardKey(
        requestId,
      );

      const record =
        objectRecord(data);
      const conversationId =
        text(record.conversationId);
      const stream = requestId
        ? options.streams[requestId]
        : undefined;
      const assistantMessageId =
        text(record.assistantMessageId)
        || stream?.assistantMessageId
        || requestId;

      if (
        stream
        && conversationId
      ) {
        await options.bumpStreaming(
          conversationId,
          -1,
        );
      }

      if (requestId) {
        delete options.streams[
          requestId
        ];
      }

      projectChatTurnMessageEnvelopes(
        data,
        options.onReply,
      );

      if (!isAutomationTurnPayload(data)) {
        options.onTurnEvent(
          'chat.turn.cancelled',
          data,
        );
      }

      options.onComplete(
        assistantMessageId,
        conversationId
          || undefined,
      );
    })();
  });

  const handleFailure = async (
    data: unknown,
  ) => {
    const record =
      objectRecord(data);

    const conversationId =
      text(
        record.conversationId,
      );

    const requestId =
      requestKey(data);

    if (
      options.terminalTraceIds.has(
        requestId,
      )
    ) {
      return;
    }

    options.terminalTraceIds.add(
      requestId,
    );

    projectChatTurnMessageEnvelopes(
      data,
      options.onReply,
    );

    if (!isAutomationTurnPayload(data)) {
      options.onTurnEvent(
        'chat.response.failed',
        data,
      );
    }

    console.error(
      '[ChatWS] chat execution failed',
      {
        traceId:
          requestId || null,
        conversationId:
          conversationId || null,
        code:
          record.code
          ?? record.reasonCode
          ?? null,
        message:
          record.message
          ?? record.error
          ?? null,
      },
    );

    try {
      options.onFailure?.(data);
    } catch (error) {
      console.error(
        '[ChatWS] chat failure handler failed',
        {
          error: messageOf(error),
        },
      );
    }

    const stream =
      requestId
        ? options.streams[
            requestId
          ]
        : undefined;

    const hadStream =
      Boolean(stream);

    if (
      hadStream
      && conversationId
    ) {
      try {
        await options.bumpStreaming(
          conversationId,
          -1,
        );
      } catch {
                              
      }
    }

    if (requestId) {
      delete options.streams[
        requestId
      ];
    }

    batcher.discardKey(
      requestId,
    );

    options.onComplete(
      text(
        record.assistantMessageId,
      )
      || stream
        ?.assistantMessageId
      || requestId,
      conversationId
        || undefined,
    );
  };

  socket.on(
    'chat.response.failed',
    (data: unknown) => {
      void handleFailure(data);
    },
  );

  return batcher;
}

export function detachChatDeliveryListeners(
  socket: Socket,
): void {
  for (const event of DELIVERY_EVENTS) {
    socket.off(event);
  }
}

function isAutomationTurnPayload(value: unknown): boolean {
  const record = objectRecord(value);
  return text(record.source) === 'automation'
    || Boolean(text(record.automationRunId))
    || text(record.traceId).startsWith('automation_');
}

function dispatchWindowEvent(
  name: string,
  detail: unknown,
): void {
  try {
    window.dispatchEvent(
      new CustomEvent(
        name,
        { detail },
      ),
    );
  } catch (error) {
    console.error(
      '[ChatWS] window event dispatch failed',
      {
        eventName: name,
        error:
          messageOf(error),
      },
    );
  }
}

function requestKey(
  value: unknown,
): string {
  const record =
    objectRecord(value);

  return text(
    record.traceId
    ?? record.id,
  );
}

function objectRecord(
  value: unknown,
): Record<string, any> {
  return value
    && typeof value
      === 'object'
    && !Array.isArray(value)
      ? value as Record<
          string,
          any
        >
      : {};
}

function text(
  value: unknown,
): string {
  return String(
    value ?? '',
  ).trim();
}

function messageOf(
  value: unknown,
): string {
  return value
    instanceof Error
      ? value.message
      : String(value);
}