import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';
import type { RuntimeEvent, RuntimeEventInput } from './runtime-event.types';

@Injectable()
export class RuntimeEventBus implements OnModuleDestroy {
  private readonly subject = new Subject<RuntimeEvent>();
  private readonly sequenceByAggregate = new Map<string, number>();
  readonly events$: Observable<RuntimeEvent> = this.subject.asObservable();

  publish(event: RuntimeEventInput): RuntimeEvent {
    return this.emit(event);
  }

  async publishDurable(event: RuntimeEventInput): Promise<RuntimeEvent> {
    return this.emit(event);
  }

  async publishLiveDurable(event: RuntimeEventInput): Promise<RuntimeEvent> {
    return this.emit(event);
  }

  publishTransient(event: RuntimeEventInput): RuntimeEvent {
    return this.emit(event);
  }

  publishSequencedTransient(event: RuntimeEventInput): RuntimeEvent {
    return this.emit(event);
  }

  onModuleDestroy(): void {
    this.subject.complete();
    this.sequenceByAggregate.clear();
  }

  private emit(input: RuntimeEventInput): RuntimeEvent {
    const scope = { ...(input.scope ?? {}) };
    const refs = { ...(input.refs ?? {}) };
    const aggregate = String(
      (scope as any).messageId ??
      (scope as any).turnId ??
      (scope as any).conversationId ??
      (refs as any).traceId ??
      'runtime',
    );
    const sequence = input.sequence && input.sequence > 0
      ? input.sequence
      : (this.sequenceByAggregate.get(aggregate) ?? 0) + 1;
    this.sequenceByAggregate.set(aggregate, sequence);
    const event: RuntimeEvent = {
      eventId: input.eventId || `evt_${randomUUID()}`,
      sequence,
      type: input.type,
      level: input.level ?? 'info',
      stage: input.stage ?? 'api',
      status: input.status ?? null,
      scope,
      refs,
      timing: { timestamp: new Date().toISOString(), durationMs: input.durationMs ?? null },
      title: input.title ?? null,
      message: input.message ?? null,
      reasonCodes: [...(input.reasonCodes ?? [])],
      warnings: [...(input.warnings ?? [])],
      payload: input.payload ?? null,
      source: input.source ?? 'seekmore-agent',
    };
    this.subject.next(event);
    return event;
  }
}
