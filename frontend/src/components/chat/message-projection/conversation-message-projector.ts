import type { Message } from '../../../utils/types';

export interface AssistantMessageAnchor {
  conversationId: string;
  assistantMessageId?: string | null;
  traceId?: string | null;
  agentId?: string | null;
  parentMessageId?: string | null;
  rootMessageId?: string | null;
  branchId?: string | null;
  createdAt?: number | string | null;
}

export function projectConversationMessage(
  previous: Message[],
  incoming: Message,
): Message[] {
  const index = previous.findIndex((message) =>
    sameConversationMessage(message, incoming),
  );

  if (index < 0) {
    return orderConversationMessages([
      ...previous,
      incoming,
    ]);
  }

  const merged = mergeConversationMessage(
    previous[index],
    incoming,
  );

  if (merged === previous[index]) {
    return previous;
  }

  const next = [...previous];
  next[index] = merged;
  return orderConversationMessages(next);
}

export function projectConversationMessages(
  previous: Message[],
  incoming: Message[],
): Message[] {
  let next = previous;

  for (const message of incoming) {
    next = projectConversationMessage(next, message);
  }

  return next;
}

export function ensureAnchoredAssistantShell(
  messages: Message[],
  input: AssistantMessageAnchor,
): Message[] {
  const conversationId = text(input.conversationId);
  const assistantMessageId = text(input.assistantMessageId);
  const traceId = text(input.traceId);
  const parentMessageId = text(input.parentMessageId);

  const parentMessage = messages.find(
    (message) => message.id === parentMessageId,
  );

  if (
    !conversationId
    || !assistantMessageId
    || !parentMessageId
    || !parentMessage
  ) {
    return messages;
  }

  return projectConversationMessage(
    messages,
    {
      id: assistantMessageId,
      role: 'agent',
      parentMessageId,
      rootMessageId:
        text(input.rootMessageId)
        || text(parentMessage.rootMessageId)
        || parentMessage.id,
      branchId:
        text(input.branchId)
        || text(parentMessage.branchId)
        || text(parentMessage.rootMessageId)
        || parentMessage.id,
      content: '',
      timestamp: parseTimestamp(input.createdAt),
      is_complete: false,
      conversationId,
      isMe: false,
      senderType: 'AGENT',
      senderAgentId: text(input.agentId) || undefined,
      meta: {
        traceId: traceId || undefined,
        backendAssistantMessageId: assistantMessageId,
        userMessageId: parentMessageId,
      },
    },
  );
}

export function messageFromTurnEnvelope(
  value: unknown,
  fallback: {
    conversationId: string;
    role: 'user' | 'agent';
    traceId?: string | null;
    agentId?: string | null;
  },
): Message | null {
  const input = record(value);
  const id = text(input.id);
  const conversationId = text(
    input.conversationId
    ?? fallback.conversationId,
  );

  if (!id || !conversationId) {
    return null;
  }

  const role = input.role === 'user'
    ? 'user'
    : fallback.role;
  const traceId = text(
    input.traceId
    ?? fallback.traceId,
  );

  return {
    id,
    role,
    parentMessageId:
      nullableText(input.parentMessageId),
    rootMessageId:
      nullableText(input.rootMessageId),
    branchId:
      nullableText(input.branchId),
    branchable: role === 'agent',
    content: String(input.content ?? ''),
    timestamp: parseTimestamp(
      input.createdAt
      ?? input.timestamp,
    ),
    is_complete:
      input.is_complete === true
      || input.isComplete === true,
    conversationId,
    isMe: role === 'user',
    senderType: role === 'user'
      ? 'USER'
      : 'AGENT',
    senderAgentId: role === 'agent'
      ? text(fallback.agentId) || undefined
      : undefined,
    meta: {
      ...record(input.meta),
      traceId: traceId || undefined,
      ...(role === 'agent'
        ? {
            backendAssistantMessageId: id,
            userMessageId:
              nullableText(input.parentMessageId)
              ?? undefined,
          }
        : {}),
    },
  };
}

export function sameConversationMessage(
  left: Message,
  right: Message,
): boolean {
  if (left.role !== right.role) {
    return false;
  }

  if (left.id === right.id) {
    return true;
  }

  if (left.role !== 'agent') {
    return false;
  }

  const leftMeta = record(left.meta);
  const rightMeta = record(right.meta);
  const leftTraceId = text(leftMeta.traceId);
  const rightTraceId = text(rightMeta.traceId);
  const leftAssistantId = text(
    leftMeta.backendAssistantMessageId,
  );
  const rightAssistantId = text(
    rightMeta.backendAssistantMessageId,
  );

  return Boolean(
    leftTraceId
    && rightTraceId
    && leftTraceId === rightTraceId,
  ) || Boolean(
    leftAssistantId
    && rightAssistantId
    && leftAssistantId === rightAssistantId,
  );
}

export function mergeConversationMessage(
  current: Message,
  incoming: Message,
): Message {
  const currentComplete = current.is_complete === true;
  const incomingComplete = incoming.is_complete === true;
  const incomingContent = String(incoming.content ?? '');
  const currentContent = String(current.content ?? '');
  const content = currentComplete && !incomingComplete
    ? currentContent
    : incomingContent || currentContent;

  return {
    ...current,
    ...incoming,
    id: incoming.id || current.id,
    conversationId:
      incoming.conversationId
      || current.conversationId,
    parentMessageId:
      incoming.parentMessageId !== undefined
        ? incoming.parentMessageId
        : current.parentMessageId,
    rootMessageId:
      incoming.rootMessageId !== undefined
        ? incoming.rootMessageId
        : current.rootMessageId,
    branchId:
      incoming.branchId !== undefined
        ? incoming.branchId
        : current.branchId,
    content,
    is_complete:
      currentComplete || incomingComplete,
    citations:
      incoming.citations !== undefined
        ? incoming.citations
        : current.citations,
    objects:
      incoming.objects !== undefined
        ? incoming.objects
        : current.objects,
    runtime:
      incoming.runtime !== undefined
        ? incoming.runtime
        : current.runtime,
    meta: {
      ...record(current.meta),
      ...record(incoming.meta),
    },
  };
}

export function orderConversationMessages(
  messages: Message[],
): Message[] {
  if (messages.length < 2) {
    return messages;
  }

  const byId = new Map<string, Message>();
  const originalIndex = new Map<string, number>();

  messages.forEach((message, index) => {
    const id = text(message.id);
    if (!id) return;
    byId.set(id, message);
    if (!originalIndex.has(id)) {
      originalIndex.set(id, index);
    }
  });

  const children = new Map<string, Message[]>();
  const roots: Message[] = [];

  for (const message of byId.values()) {
    const parentMessageId = text(
      message.parentMessageId,
    );

    if (
      !parentMessageId
      || !byId.has(parentMessageId)
    ) {
      roots.push(message);
      continue;
    }

    const bucket = children.get(parentMessageId) ?? [];
    bucket.push(message);
    children.set(parentMessageId, bucket);
  }

  const compare = (
    left: Message,
    right: Message,
    parent?: Message,
  ): number => {
    const roleDifference = childRolePriority(
      parent?.role,
      left.role,
    ) - childRolePriority(
      parent?.role,
      right.role,
    );

    if (roleDifference !== 0) {
      return roleDifference;
    }

    const timestampDifference =
      finiteTimestamp(left.timestamp)
      - finiteTimestamp(right.timestamp);

    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    return (
      (originalIndex.get(left.id) ?? 0)
      - (originalIndex.get(right.id) ?? 0)
    ) || left.id.localeCompare(right.id);
  };

  roots.sort((left, right) =>
    compare(left, right),
  );

  const output: Message[] = [];
  const visited = new Set<string>();

  const append = (message: Message) => {
    if (visited.has(message.id)) {
      return;
    }

    visited.add(message.id);
    output.push(message);

    const descendants = [
      ...(children.get(message.id) ?? []),
    ].sort((left, right) =>
      compare(left, right, message),
    );

    for (const child of descendants) {
      append(child);
    }
  };

  for (const root of roots) {
    append(root);
  }

  for (const message of messages) {
    append(message);
  }

  return arraysEqual(messages, output)
    ? messages
    : output;
}

function childRolePriority(
  parentRole: Message['role'] | undefined,
  childRole: Message['role'],
): number {
  if (parentRole === 'user') {
    if (childRole === 'agent') return 0;
    if (childRole === 'user') return 1;
    return 2;
  }

  if (parentRole === 'agent') {
    if (childRole === 'user') return 0;
    if (childRole === 'agent') return 1;
    return 2;
  }

  if (childRole === 'user') return 0;
  if (childRole === 'agent') return 1;
  return 2;
}

function arraysEqual(
  left: Message[],
  right: Message[],
): boolean {
  return left.length === right.length
    && left.every(
      (message, index) =>
        message === right[index],
    );
}

function finiteTimestamp(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? number
    : Number.MAX_SAFE_INTEGER;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed)
    ? parsed
    : Date.now();
}

function nullableText(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function record(value: unknown): Record<string, any> {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
      ? value as Record<string, any>
      : {};
}
