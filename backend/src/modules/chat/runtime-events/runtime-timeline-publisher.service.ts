import { Injectable, Logger } from '@nestjs/common';
import type { RuntimePublicTimelineEvent } from './runtime-assistant-timeline.types';
import { RuntimeTimelineEventRepository } from './runtime-timeline-event.repository';

interface TimelinePersistenceErrorDetails {
  code: string;
  databaseCode: string;
  message: string;
  meta: string;
  stack?: string;
}

@Injectable()
export class RuntimeTimelinePublisher {
  private readonly logger = new Logger(RuntimeTimelinePublisher.name);

  constructor(private readonly events: RuntimeTimelineEventRepository) {}

  async publish(event: RuntimePublicTimelineEvent): Promise<string | null> {
    try {
      return await this.events.append(event);
    } catch (error) {
      const details = this.errorDetails(error);
      const message = [
        'runtime_timeline_persist_failed',
        `eventId=${event.eventId}`,
        `eventType=${event.type}`,
        `code=${details.code}`,
        `databaseCode=${details.databaseCode}`,
        `meta=${details.meta}`,
        `message=${details.message}`,
      ].join(' ');

      if (this.isDegradableEventError(error, details)) {
        this.logger.warn(`${message} degraded=true`);
        return null;
      }

      this.logger.error(message, details.stack);
      throw error;
    }
  }

  private isDegradableEventError(
    error: unknown,
    details: TimelinePersistenceErrorDetails,
  ): boolean {
    if (details.code === 'P2000' || details.code === 'P2002') {
      return true;
    }

    const searchable = [
      details.code,
      details.databaseCode,
      details.message,
      details.meta,
      error instanceof Error ? error.stack ?? '' : '',
    ].join(' ');

    return /22P05|unsupported Unicode escape sequence|\\u0000 cannot be converted to text|invalid input syntax for type json/i.test(searchable);
  }

  private errorDetails(error: unknown): TimelinePersistenceErrorDetails {
    const record = this.record(error);
    const metaRecord = this.record(record.meta);
    const causeRecord = this.record(record.cause);
    const databaseCode = String(
      metaRecord.code
      ?? metaRecord.database_error_code
      ?? causeRecord.code
      ?? '-',
    );

    return {
      code: String(record.code ?? '-'),
      databaseCode,
      message: error instanceof Error ? error.message : String(error),
      meta: this.safeStringify(record.meta ?? null),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value, (_key, item) =>
        typeof item === 'bigint' ? item.toString() : item,
      ) ?? 'null';
    } catch {
      return String(value);
    }
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
