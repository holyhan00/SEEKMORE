import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type {
  RuntimePublicTimelineEvent,
} from './runtime-assistant-timeline.types';
import { sanitizeRuntimeTimelineJson } from './runtime-timeline-json-sanitizer';

export type RuntimeTimelineReplayEvent = RuntimePublicTimelineEvent & {
  replayCursor: string;
};

@Injectable()
export class RuntimeTimelineEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(event: RuntimePublicTimelineEvent): Promise<string> {
    const identityKey = this.identityKey(event);
    const workflowId =
      event.type === 'assistant.timeline.activity'
        ? event.activity.workflowId
        : null;
    const payloadJson = sanitizeRuntimeTimelineJson(event);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const activeConversation = await (tx as any).conversation.findFirst({
            where: {
              id: event.conversationId,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!activeConversation) return '0';

          const existing = await (tx as any).runtimeTimelineEvent.findUnique({
            where: { eventId: event.eventId },
            select: { sequence: true },
          });
          if (existing) return String(existing.sequence);

          const latest = await (tx as any).runtimeTimelineEvent.findFirst({
            where: {
              presentationMessageId: event.assistantMessageId,
              identityKey,
            },
            orderBy: { version: 'desc' },
            select: { version: true },
          });

          const row = await (tx as any).runtimeTimelineEvent.create({
            data: {
              eventId: event.eventId,
              conversationId: event.conversationId,
              presentationMessageId: event.assistantMessageId,
              sourceAssistantMessageId: event.assistantMessageId,
              traceId: event.traceId,
              workflowId,
              identityKey,
              version: Number(latest?.version ?? 0) + 1,
              type: event.type,
              payloadJson,
            },
            select: { sequence: true },
          });

          return String(row.sequence);
        });
      } catch (error) {
        if (!this.isUniqueConflict(error) || attempt === 2) throw error;
      }
    }

    throw new Error('RUNTIME_TIMELINE_APPEND_RETRY_EXHAUSTED');
  }

  async list(input: {
    userId: string;
    conversationId: string;
    afterSequence?: string | null;
    limit?: number;
  }): Promise<{
    events: RuntimeTimelineReplayEvent[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const allowed = await this.assertConversation(
      input.userId,
      input.conversationId,
    );
    if (!allowed) {
      return {
        events: [],
        nextCursor: input.afterSequence ?? null,
        hasMore: false,
      };
    }

    const limit = Math.min(1000, Math.max(1, input.limit ?? 500));
    const after = this.bigInt(input.afterSequence);
    const rows = await (this.prisma as any).runtimeTimelineEvent.findMany({
      where: {
        conversationId: input.conversationId,
        ...(after == null ? {} : { sequence: { gt: after } }),
      },
      orderBy: { sequence: 'asc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const events = page.map((row: any) =>
      this.replayEvent(row.payloadJson, row.sequence),
    );

    return {
      events,
      nextCursor: page.length
        ? String(page[page.length - 1].sequence)
        : input.afterSequence ?? null,
      hasMore,
    };
  }

  async snapshot(input: {
    userId: string;
    conversationId: string;
  }): Promise<{
    events: RuntimeTimelineReplayEvent[];
    nextCursor: string | null;
    hasMore: false;
  }> {
    const allowed = await this.assertConversation(
      input.userId,
      input.conversationId,
    );
    if (!allowed) {
      return { events: [], nextCursor: null, hasMore: false };
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ sequence: bigint; payload_json: unknown }>
    >(Prisma.sql`
      SELECT DISTINCT ON ("presentation_message_id", "identity_key")
        "sequence",
        "payload_json"
      FROM "runtime_timeline_event"
      WHERE "conversation_id" = ${input.conversationId}
      ORDER BY
        "presentation_message_id" ASC,
        "identity_key" ASC,
        "version" DESC,
        "sequence" DESC
    `);

    rows.sort((left, right) =>
      left.sequence < right.sequence
        ? -1
        : left.sequence > right.sequence
          ? 1
          : 0,
    );

    const events = rows.map((row) =>
      this.replayEvent(row.payload_json, row.sequence),
    );

    return {
      events,
      nextCursor: rows.length
        ? String(rows[rows.length - 1].sequence)
        : null,
      hasMore: false,
    };
  }

  private async assertConversation(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    const conversation = await (this.prisma as any).conversation.findFirst({
      where: {
        id: conversationId,
        userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    return Boolean(conversation);
  }

  private replayEvent(
    payload: unknown,
    sequence: bigint | number | string,
  ): RuntimeTimelineReplayEvent {
    return {
      ...(this.record(payload) as unknown as RuntimePublicTimelineEvent),
      replayCursor: String(sequence),
    };
  }

  private identityKey(event: RuntimePublicTimelineEvent): string {
    if (event.type === 'assistant.timeline.content') {
      return `content:${event.block.blockId}`;
    }
    if (event.type === 'assistant.timeline.step') {
      return `step:${event.step.stepId}`;
    }
    if (event.type === 'assistant.timeline.reasoning_summary') {
      return `reasoning:${event.summary.summaryId}`;
    }
    return `activity:${event.activity.activityId}`;
  }

  private isUniqueConflict(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        String((error as { code?: unknown }).code ?? '') === 'P2002',
    );
  }

  private bigInt(value: string | null | undefined): bigint | null {
    if (!value || !/^\d+$/.test(value)) return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
