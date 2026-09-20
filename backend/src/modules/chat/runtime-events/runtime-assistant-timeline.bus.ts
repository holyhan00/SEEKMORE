import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';
import { RuntimeTimelineSequenceService } from './runtime-timeline-sequence.service';
import { RuntimeTimelinePublisher } from './runtime-timeline-publisher.service';
import type {
  RuntimePublicActivity,
  RuntimePublicReasoningSummary,
  RuntimePublicStep,
  RuntimePublicTimelineEvent,
} from './runtime-assistant-timeline.types';

interface TimelineEnvelopeInput {
  userId?: string | null;
  eventId?: string | null;
  sequence?: number | null;
  conversationId: string;
  assistantMessageId: string;
  traceId?: string | null;
  createdAt?: number | null;
}

type SnapshotBucket = {
  content: Map<string, RuntimePublicTimelineEvent>;
  steps: Map<string, RuntimePublicTimelineEvent>;
  reasoning: Map<string, RuntimePublicTimelineEvent>;
  activities: Map<string, RuntimePublicTimelineEvent>;
};

@Injectable()
export class RuntimeAssistantTimelineBus implements OnModuleDestroy {
  private readonly logger = new Logger(RuntimeAssistantTimelineBus.name);
  private readonly subject = new Subject<RuntimePublicTimelineEvent>();
  private readonly lastActivityByKey = new Map<
    string,
    { signature: string; event: RuntimePublicTimelineEvent }
  >();
  private readonly snapshots = new Map<string, SnapshotBucket>();
  private publishQueue: Promise<void> = Promise.resolve();
  private persistenceError: Error | null = null;

  readonly events$: Observable<RuntimePublicTimelineEvent> =
    this.subject.asObservable();

  constructor(
    private readonly sequences: RuntimeTimelineSequenceService,
    private readonly publisher: RuntimeTimelinePublisher,
  ) {}

  publishActivity(
    input: TimelineEnvelopeInput & {
      activity: Omit<RuntimePublicActivity, 'sequence'> & {
        sequence?: number;
      };
    },
  ) {
    const key = `${input.assistantMessageId}:${input.activity.activityId}`;
    const signature = JSON.stringify({
      status: input.activity.status,
      title: input.activity.title,
      presentation: input.activity.presentation ?? null,
      summary: input.activity.summary ?? null,
      summaryPresentation: input.activity.summaryPresentation ?? null,
      progress: input.activity.progress ?? null,
      operation: input.activity.operation ?? null,
      target: input.activity.target ?? null,
      detail: input.activity.detail ?? null,
    });
    const previous = this.lastActivityByKey.get(key);
    if (previous?.signature === signature) return previous.event;

    const sequence = previous?.event.sequence ?? this.sequence(input);
    const event: RuntimePublicTimelineEvent = this.envelope(
      input,
      sequence,
      {
        type: 'assistant.timeline.activity',
        activity: { ...input.activity, sequence },
      },
    );

    this.lastActivityByKey.set(key, { signature, event });
    this.store(event);
    this.emit(event);
    return event;
  }

  publishStep(
    input: TimelineEnvelopeInput & { step: RuntimePublicStep },
  ): RuntimePublicTimelineEvent {
    const previous = this.bucket(input.assistantMessageId).steps.get(
      input.step.stepId,
    );
    const previousStep =
      previous?.type === 'assistant.timeline.step' ? previous.step : null;
    const sequence = previous?.sequence ?? this.sequence(input);
    const step: RuntimePublicStep = {
      ...input.step,
      title: input.step.title ?? previousStep?.title ?? null,
      presentation: input.step.presentation ?? previousStep?.presentation ?? null,
      startedAt: previousStep?.startedAt ?? input.step.startedAt,
    };
    const event = this.envelope(input, sequence, {
      type: 'assistant.timeline.step',
      step,
    });
    this.store(event);
    this.emit(event);
    return event;
  }

  publishReasoningSummary(
    input: TimelineEnvelopeInput & {
      summary: RuntimePublicReasoningSummary;
    },
  ): RuntimePublicTimelineEvent | null {
    if (!input.summary.markdown.trim()) return null;
    const previous = this.bucket(input.assistantMessageId).reasoning.get(
      input.summary.summaryId,
    );
    const sequence = previous?.sequence ?? this.sequence(input);
    const event = this.envelope(input, sequence, {
      type: 'assistant.timeline.reasoning_summary',
      summary: input.summary,
    });
    this.store(event);

                                          
    this.emit(event, input.summary.status === 'completed');
    return event;
  }

  publishContent(
    input: TimelineEnvelopeInput & {
      blockId: string;
      role: 'commentary' | 'final';
      markdown: string;
      final: boolean;
      stepId?: string | null;
    },
  ): RuntimePublicTimelineEvent | null {
    if (!input.markdown.trim()) return null;
    const previous = this.bucket(input.assistantMessageId).content.get(
      input.blockId,
    );
    const sequence = previous?.sequence ?? this.sequence(input);
    const event = this.envelope(input, sequence, {
      type: 'assistant.timeline.content',
      block: {
        blockId: input.blockId,
        role: input.role,
        markdown: input.markdown,
        final: input.final,
        stepId: input.stepId ?? null,
      },
    });
    this.store(event);
    this.emit(event);
    return event;
  }

  snapshot(assistantMessageId: string): RuntimePublicTimelineEvent[] {
    const bucket = this.snapshots.get(assistantMessageId);
    if (!bucket) return [];

    return [
      ...bucket.steps.values(),
      ...bucket.reasoning.values(),
      ...bucket.activities.values(),
      ...bucket.content.values(),
    ].sort(
      (a, b) =>
        a.sequence - b.sequence || a.eventId.localeCompare(b.eventId),
    );
  }

  async flush(_assistantMessageId?: string): Promise<void> {
    await this.publishQueue;
    const error = this.persistenceError;
    this.persistenceError = null;
    if (error) throw error;
  }

  clear(assistantMessageId: string): void {
    this.snapshots.delete(assistantMessageId);
    this.sequences.clear(assistantMessageId);
    for (const key of [...this.lastActivityByKey.keys()]) {
      if (key.startsWith(`${assistantMessageId}:`)) {
        this.lastActivityByKey.delete(key);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.flush();
    } catch (error) {
      this.logger.error(
        `runtime_timeline_shutdown_flush_failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.lastActivityByKey.clear();
    this.snapshots.clear();
    this.subject.complete();
  }

  private emit(
    event: RuntimePublicTimelineEvent,
    persist = true,
  ): void {
    this.publishQueue = this.publishQueue
      .catch(() => undefined)
      .then(async () => {
        if (persist) {
          try {
            await this.publisher.publish(event);
          } catch (error) {
            const normalized =
              error instanceof Error ? error : new Error(String(error));
            this.persistenceError = normalized;
            this.logger.error(
              `runtime_timeline_publish_failed eventId=${event.eventId}: ${normalized.message}`,
            );
          }
        }
        this.subject.next(event);
      })
      .catch((error) => {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        this.persistenceError = normalized;
        this.logger.error(
          `runtime_timeline_dispatch_failed eventId=${event.eventId}: ${normalized.message}`,
        );
      });
  }

  private envelope(
    input: TimelineEnvelopeInput,
    sequence: number,
    payload: unknown,
  ): RuntimePublicTimelineEvent {
    return {
      eventId: input.eventId || `timeline_${randomUUID()}`,
      sequence,
      userId: input.userId ?? null,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      traceId: input.traceId ?? null,
      createdAt: input.createdAt ?? Date.now(),
      ...(payload as object),
    } as RuntimePublicTimelineEvent;
  }

  private store(event: RuntimePublicTimelineEvent): void {
    const bucket = this.bucket(event.assistantMessageId);
    if (event.type === 'assistant.timeline.content') {
      bucket.content.set(event.block.blockId, event);
    } else if (event.type === 'assistant.timeline.step') {
      bucket.steps.set(event.step.stepId, event);
    } else if (event.type === 'assistant.timeline.reasoning_summary') {
      bucket.reasoning.set(event.summary.summaryId, event);
    } else if (event.type === 'assistant.timeline.activity') {
      bucket.activities.set(event.activity.activityId, event);
    }
  }

  private bucket(id: string): SnapshotBucket {
    let value = this.snapshots.get(id);
    if (!value) {
      value = {
        content: new Map(),
        steps: new Map(),
        reasoning: new Map(),
        activities: new Map(),
      };
      this.snapshots.set(id, value);
    }
    return value;
  }

  private sequence(input: TimelineEnvelopeInput): number {
    if (input.sequence && input.sequence > 0) {
      this.sequences.observe(input.assistantMessageId, input.sequence);
      return input.sequence;
    }
    return this.sequences.next(input.assistantMessageId);
  }
}
