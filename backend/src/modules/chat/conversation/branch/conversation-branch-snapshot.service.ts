import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageRole, type Message } from '@prisma/client';

const MAX_BRANCH_MESSAGES = 500;

type MessageSnapshotContext = {
  role: MessageRole;
  sourceConversationId: string;
  sourceMessageId: string;
  targetConversationId: string;
  targetMessageId: string;
  branchSnapshotBoundary?: boolean;
};

@Injectable()
export class ConversationBranchSnapshotService {
  buildAncestorChain(input: {
    conversationId: string;
    fromMessageId: string;
    messages: Message[];
  }): Message[] {
    const byId = new Map(input.messages.map((message) => [message.id, message]));
    const target = byId.get(input.fromMessageId);
    if (!target || target.conversationId !== input.conversationId || target.deletedAt) {
      throw new NotFoundException({ code: 'BRANCH_SOURCE_MESSAGE_NOT_FOUND', message: 'BRANCH_SOURCE_MESSAGE_NOT_FOUND' });
    }
    if (target.role !== MessageRole.ASSISTANT) {
      throw new BadRequestException({ code: 'BRANCH_SOURCE_NOT_ASSISTANT', message: 'BRANCH_SOURCE_NOT_ASSISTANT' });
    }
    if (target.unfinished || target.status !== 'finished' || target.error) {
      throw new BadRequestException({ code: 'BRANCH_SOURCE_NOT_COMPLETED', message: 'BRANCH_SOURCE_NOT_COMPLETED' });
    }

    const chain: Message[] = [];
    const visited = new Set<string>();
    let cursor: Message | undefined = target;

    while (cursor) {
      if (visited.has(cursor.id)) {
        throw new BadRequestException({ code: 'BRANCH_MESSAGE_TREE_CYCLE', message: 'BRANCH_MESSAGE_TREE_CYCLE' });
      }
      if (chain.length >= MAX_BRANCH_MESSAGES) {
        throw new BadRequestException({ code: 'BRANCH_CONTEXT_TOO_LONG', message: 'BRANCH_CONTEXT_TOO_LONG' });
      }
      if (cursor.conversationId !== input.conversationId) {
        throw new BadRequestException({ code: 'BRANCH_MESSAGE_CROSS_CONVERSATION', message: 'BRANCH_MESSAGE_CROSS_CONVERSATION' });
      }

      visited.add(cursor.id);
      chain.push(cursor);
      if (!cursor.parentMessageId) break;
      cursor = byId.get(cursor.parentMessageId);
      if (!cursor) {
        throw new BadRequestException({ code: 'BRANCH_PARENT_CHAIN_INCOMPLETE', message: 'BRANCH_PARENT_CHAIN_INCOMPLETE' });
      }
    }

    return chain
      .reverse()
      .filter((message) => this.isSnapshotEligible(message));
  }

  sanitizeConversationMeta(value: unknown, branch: {
    parentConversationId: string;
    branchFromMessageId: string;
  }): Record<string, unknown> {
    const source = asRecord(value);
    const sanitized = omitKeys(source, CONVERSATION_TRANSIENT_KEYS);
    return {
      ...sanitized,
      branch: {
        parentConversationId: branch.parentConversationId,
        branchFromMessageId: branch.branchFromMessageId,
        createdAt: new Date().toISOString(),
      },
    };
  }

  sanitizeMessageMeta(
    value: unknown,
    context?: MessageSnapshotContext,
  ): Record<string, unknown> {
    const source = asRecord(value);
    const sanitized = omitKeys(source, MESSAGE_TRANSIENT_KEYS);

    if (context?.role === MessageRole.ASSISTANT) {
      const runtime = buildHistoricalRuntimeSnapshot(source, context);
      if (runtime) sanitized.runtime = runtime;
    }

    if (context?.branchSnapshotBoundary) {
      sanitized.branchSnapshotBoundary = true;
    }

    return sanitized;
  }

  cloneJson<T>(value: T): T {
    return value === null || value === undefined
      ? value
      : JSON.parse(JSON.stringify(value)) as T;
  }

  remapJsonReferences<T>(
    value: T,
    replacements: ReadonlyMap<string, string>,
  ): T {
    if (replacements.size === 0 || value === null || value === undefined) {
      return this.cloneJson(value);
    }
    return remapValue(this.cloneJson(value), replacements) as T;
  }

  private isSnapshotEligible(message: Message): boolean {
    if (message.deletedAt || message.unfinished || message.error) return false;
    if (message.status !== 'finished') return false;

    const meta = asRecord(message.meta);
    if (String(meta.visibility ?? '').toLowerCase() === 'internal') return false;

    if (message.role === MessageRole.TOOL) {
      return Boolean(message.content.trim());
    }

    return [
      MessageRole.USER,
      MessageRole.ASSISTANT,
      MessageRole.SYSTEM,
    ].includes(message.role);
  }
}

const CONVERSATION_TRANSIENT_KEYS = new Set([
  'activeRunId',
  'currentRequestId',
  'deliverySnapshot',
  'pendingApproval',
  'runtimeLock',
  'socketRoom',
  'streamState',
  'traceId',
  'workflowLock',
]);

const MESSAGE_TRANSIENT_KEYS = new Set([
  'assistantMessageId',
  'backendAssistantMessageId',
  'deliverySnapshot',
  'requestId',
  'runtime',
  'runtimeTimeline',
  'stream',
  'traceId',
  'workflowRunId',
]);

const HISTORICAL_DETAIL_TRANSIENT_KEYS = new Set([
  'accessToken',
  'approvalId',
  'authorization',
  'challenge',
  'cookie',
  'currentRequestId',
  'password',
  'refreshToken',
  'requestId',
  'runtimeLock',
  'secret',
  'taskRunId',
  'token',
  'traceId',
  'workflowId',
]);

function buildHistoricalRuntimeSnapshot(
  messageMeta: Record<string, unknown>,
  context: MessageSnapshotContext,
): Record<string, unknown> | null {
  const sourceRuntime = asRecord(messageMeta.runtime);
  const sourceTimeline = Array.isArray(sourceRuntime.timeline)
    ? sourceRuntime.timeline
    : Array.isArray(messageMeta.runtimeTimeline)
      ? messageMeta.runtimeTimeline
      : [];
  const timeline = sourceTimeline
    .map((event, index) => snapshotTimelineEvent(event, context, index))
    .filter((event): event is Record<string, unknown> => Boolean(event));

  if (timeline.length === 0 && Object.keys(sourceRuntime).length === 0) {
    return null;
  }

  const runtime: Record<string, unknown> = {
    conversationId: context.targetConversationId,
    timeline,
    historicalSnapshot: true,
  };

  copyRuntimeField(sourceRuntime, runtime, 'engine');
  copyRuntimeField(sourceRuntime, runtime, 'agentId');
  copyRuntimeField(sourceRuntime, runtime, 'metadata');
  copyRuntimeField(sourceRuntime, runtime, 'usage');
  copyRuntimeField(sourceRuntime, runtime, 'iterations');
  copyRuntimeField(sourceRuntime, runtime, 'toolCallCount');

  return runtime;
}

function copyRuntimeField(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
): void {
  if (!(key in source)) return;
  target[key] = cloneSafe(source[key]);
}

function snapshotTimelineEvent(
  value: unknown,
  context: MessageSnapshotContext,
  index: number,
): Record<string, unknown> | null {
  const event = asRecord(value);
  const type = String(event.type ?? '').trim();
  if (!TIMELINE_EVENT_TYPES.has(type)) return null;

  const sourceEventId = String(event.eventId ?? '').trim() || `${type}:${index + 1}`;
  const snapshot: Record<string, unknown> = {
    ...cloneRecord(event),
    eventId: `branch:${context.targetMessageId}:${sourceEventId}`,
    conversationId: context.targetConversationId,
    assistantMessageId: context.targetMessageId,
    traceId: null,
  };

  if (type === 'assistant.timeline.content') {
    const block = asRecord(event.block);
    snapshot.block = {
      ...cloneRecord(block),
      final: true,
    };
  }

  if (type === 'assistant.timeline.step') {
    const step = asRecord(event.step);
    const status = String(step.status ?? 'succeeded');
    snapshot.step = {
      ...cloneRecord(step),
      status: status === 'running' || status === 'waiting' ? 'succeeded' : status,
    };
  }

  if (type === 'assistant.timeline.reasoning_summary') {
    snapshot.summary = {
      ...cloneRecord(asRecord(event.summary)),
      status: 'completed',
    };
  }

  if (type === 'assistant.timeline.activity') {
    const activity = asRecord(event.activity);
    const status = String(activity.status ?? 'succeeded');
    snapshot.activity = {
      ...cloneRecord(activity),
      assistantMessageId: context.targetMessageId,
      conversationId: context.targetConversationId,
      workflowId: null,
      status: normalizeHistoricalActivityStatus(status),
      detail: sanitizeHistoricalDetail(activity.detail),
    };
  }

  return snapshot;
}

const TIMELINE_EVENT_TYPES = new Set([
  'assistant.timeline.content',
  'assistant.timeline.step',
  'assistant.timeline.reasoning_summary',
  'assistant.timeline.activity',
]);

function normalizeHistoricalActivityStatus(status: string): string {
  return ['queued', 'running', 'waiting', 'blocked'].includes(status)
    ? 'succeeded'
    : status;
}

function sanitizeHistoricalDetail(value: unknown): Record<string, unknown> | null {
  const detail = asRecord(value);
  if (Object.keys(detail).length === 0) return null;
  const sanitized = omitKeys(detail, HISTORICAL_DETAIL_TRANSIENT_KEYS);
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneSafe(nested)]),
  );
}

function omitKeys(
  input: Record<string, unknown>,
  denied: Set<string>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (denied.has(key)) continue;
    output[key] = cloneSafe(value);
  }
  return output;
}

function cloneSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(cloneSafe);
  if (typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, cloneSafe(nested)]),
  );
}

function remapValue(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => remapValue(item, replacements));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      remapValue(nested, replacements),
    ]),
  );
}
