                                                                     

import type {
  ChatObjectCard,
  Message,
} from '../../../../utils/types';
import {
  normalizeChatObjects,
} from '../../Chat.utils';
import {
  messageFromTurnEnvelope,
} from '../../message-projection/conversation-message-projector';
import {
  createChatTextStreamPresenter,
} from './chat-text-stream-presenter';

export type ChatPayloadSource =
  | 'started'
  | 'delta'
  | 'objects'
  | 'completed';

export type ChatStreamState = {
  accumulated: string;
  displayed: string;
  conversationId: string;
  assistantMessageId: string;
  userMessageId: string;
  citations: any[] | null;
  objects: ChatObjectCard[];
  runtime: any;
  userMessage: Message | null;
  assistantMessage: Message | null;
};

export function createChatPayloadAssembler(options: {
  streams: Record<string, ChatStreamState>;
  bumpStreaming(
    conversationId: string,
    delta: number,
  ): Promise<void>;
  onReply(message: Message): void;
  onComplete(
    id: string,
    conversationId?: string,
  ): void;
  touch(): void;
}) {
  const emitAssistant = (
    requestId: string,
    complete: boolean,
  ): void => {
    const stream =
      options.streams[requestId];

    if (
      !stream
      || !stream.assistantMessage
    ) {
      return;
    }

    const messageId =
      stream.assistantMessageId
      || requestId;
    const base = stream.assistantMessage;

    options.onReply({
      ...(base ?? {}),
      id: messageId,
      role: 'agent',
      parentMessageId:
        base?.parentMessageId
        ?? stream.userMessageId
        ?? null,
      rootMessageId:
        base?.rootMessageId
        ?? stream.userMessage?.rootMessageId
        ?? null,
      branchId:
        base?.branchId
        ?? stream.userMessage?.branchId
        ?? null,
      content: stream.displayed,
      timestamp:
        base?.timestamp
        ?? Date.now(),
      is_complete: complete,
      conversationId:
        stream.conversationId,
      citations: stream.citations,
      objects: stream.objects,
      runtime: stream.runtime,
      meta: {
        ...(
          base?.meta
          && typeof base.meta === 'object'
            ? base.meta
            : {}
        ),
        traceId: requestId,
        backendAssistantMessageId:
          stream.assistantMessageId
          || undefined,
        userMessageId:
          stream.userMessageId
          || undefined,
        workflowTaskDetached:
          stream.runtime
            ?.taskBoundary
            ?.detached === true,
      },
    });
  };

  const presenter =
    createChatTextStreamPresenter({
      onFrame: (
        requestId,
        displayed,
      ) => {
        const stream =
          options.streams[requestId];

        if (!stream) {
          return;
        }

        stream.displayed = displayed;
        emitAssistant(requestId, false);
      },
    });

  const assemble = async (
    data: any,
    source: ChatPayloadSource,
  ): Promise<void> => {
    options.touch();

    const requestId = text(
      data?.traceId ?? data?.id,
    );
    const conversationId = text(
      data?.conversationId,
    );

    if (!requestId || !conversationId) {
      console.warn(
        `[Socket.${source}] drop: missing traceId/id or conversationId`,
        data,
      );
      return;
    }

    let stream =
      options.streams[requestId];

    let streamCreated = false;

    if (!stream) {
      stream =
        options.streams[requestId] =
          emptyStream(
            conversationId,
          );

      streamCreated = true;
    }

    const assistantMessageId = text(
      data?.assistantMessageId,
    );
    const userMessageId = text(
      data?.userMessageId,
    );
    const userMessage =
      messageFromTurnEnvelope(
        data?.userMessage,
        {
          conversationId,
          role: 'user',
          traceId: requestId,
        },
      );
    const assistantMessage =
      messageFromTurnEnvelope(
        data?.assistantMessage,
        {
          conversationId,
          role: 'agent',
          traceId: requestId,
        },
      );

    if (assistantMessageId) {
      stream.assistantMessageId =
        assistantMessageId;
    }

    if (userMessageId) {
      stream.userMessageId =
        userMessageId;
    }

    if (userMessage) {
      stream.userMessage = userMessage;
      stream.userMessageId = userMessage.id;
    }

    if (assistantMessage) {
      stream.assistantMessage = assistantMessage;
      stream.assistantMessageId = assistantMessage.id;
    }

    const complete =
      source === 'completed';

    if (userMessage) {
      options.onReply(userMessage);
    }

    if (streamCreated) {
      await safeBump(
        options.bumpStreaming,
        conversationId,
        1,
      );
    }

    if (source === 'delta') {
      stream.accumulated = mergeStreamContent(
        stream.accumulated,
        String(data?.chunk ?? ''),
      );
    }

    if (source === 'objects') {
      stream.objects = mergeChatObjects(
        stream.objects,
        normalizeChatObjects(data?.objects),
      );
      emitAssistant(requestId, false);
      return;
    }

    if (
      complete
      && typeof data?.content === 'string'
    ) {
      stream.accumulated = data.content;
    }

    if (
      !complete
      && Array.isArray(data?.citations)
    ) {
      stream.citations = data.citations;
    }

    if (
      !complete
      && data?.runtime !== undefined
    ) {
      stream.runtime = data.runtime;
    }

    if (source === 'started') {
      emitAssistant(requestId, false);
      return;
    }

    if (source === 'delta') {
      presenter.update(
        requestId,
        stream.accumulated,
        stream.displayed,
      );
      return;
    }

    stream.displayed =
      await presenter.complete(
        requestId,
        stream.accumulated,
        stream.displayed,
      );

    if (Array.isArray(data?.citations)) {
      stream.citations = data.citations;
    } else if (data?.citations === null) {
      stream.citations = null;
    }

    if (data?.runtime !== undefined) {
      stream.runtime = data.runtime;
    }

    stream.objects = mergeChatObjects(
      stream.objects,
      normalizeChatObjects(data?.objects),
    );

    emitAssistant(requestId, true);

    const messageId =
      stream.assistantMessageId
      || requestId;

    options.onComplete(
      messageId,
      conversationId,
    );

    await safeBump(
      options.bumpStreaming,
      conversationId,
      -1,
    );

    presenter.discard(requestId);
    delete options.streams[requestId];
  };

  return {
    assemble,
    discard(requestId: string): void {
      presenter.discard(requestId);
    },
    dispose(): void {
      presenter.dispose();
    },
  };
}

export function projectChatTurnMessageEnvelopes(
  data: any,
  onReply: (message: Message) => void,
): void {
  const conversationId = text(
    data?.conversationId,
  );
  const traceId = text(
    data?.traceId ?? data?.id,
  );

  if (!conversationId) {
    return;
  }

  const userMessage =
    messageFromTurnEnvelope(
      data?.userMessage,
      {
        conversationId,
        role: 'user',
        traceId,
      },
    );
  const assistantMessage =
    messageFromTurnEnvelope(
      data?.assistantMessage,
      {
        conversationId,
        role: 'agent',
        traceId,
        agentId: text(data?.agentId),
      },
    );

  if (userMessage) {
    onReply(userMessage);
  }

  if (assistantMessage) {
    onReply(assistantMessage);
  }
}

export function mergeChatDeltaPayload(
  current: any,
  incoming: any,
): any {
  return {
    ...current,
    ...incoming,
    chunk: mergeStreamContent(
      String(current?.chunk ?? ''),
      String(incoming?.chunk ?? ''),
    ),
  };
}

function mergeChatObjects(
  current: ChatObjectCard[],
  incoming: ChatObjectCard[],
): ChatObjectCard[] {
  const objects = new Map<string, ChatObjectCard>();

  for (const object of current) {
    if (!object?.objectId) continue;
    objects.set(object.objectId, object);
  }

  for (const object of incoming) {
    if (!object?.objectId) continue;
    objects.set(object.objectId, object);
  }

  return [...objects.values()].sort(
    (left, right) =>
      (left.position ?? 0)
      - (right.position ?? 0),
  );
}

function mergeStreamContent(
  current: string,
  incoming: string,
): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;

  const overlap = longestSuffixPrefixOverlap(
    current,
    incoming,
  );

  return current + incoming.slice(overlap);
}

function longestSuffixPrefixOverlap(
  current: string,
  incoming: string,
): number {
  const maximum = Math.min(
    current.length,
    incoming.length,
  );

  for (
    let length = maximum;
    length > 0;
    length -= 1
  ) {
    if (
      current.slice(-length)
      === incoming.slice(0, length)
    ) {
      return length;
    }
  }

  return 0;
}

function emptyStream(
  conversationId: string,
): ChatStreamState {
  return {
    accumulated: '',
    displayed: '',
    conversationId,
    assistantMessageId: '',
    userMessageId: '',
    citations: null,
    objects: [],
    runtime: null,
    userMessage: null,
    assistantMessage: null,
  };
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

async function safeBump(
  run: (
    conversationId: string,
    delta: number,
  ) => Promise<void>,
  conversationId: string,
  delta: number,
): Promise<void> {
  try {
    await run(conversationId, delta);
  } catch {
                                                 
  }
}