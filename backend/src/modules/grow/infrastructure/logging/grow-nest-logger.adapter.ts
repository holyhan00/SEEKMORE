import { Injectable, Logger } from '@nestjs/common';
import type { GrowLoggerPort, GrowLogRecord } from '../../ports/grow-logger.port';

@Injectable()
export class GrowNestLoggerAdapter implements GrowLoggerPort {
  private readonly logger = new Logger('GROW');

  log(record: GrowLogRecord): void {
    const fields = record.fields && Object.keys(record.fields).length
      ? ` ${this.safeJson(record.fields)}`
      : '';
    const message = `[GROW][${record.event}] ${record.message}${fields}`;
    if (record.level === 'error') this.logger.error(message);
    else if (record.level === 'warn') this.logger.warn(message);
    else if (record.level === 'debug') this.logger.debug(message);
    else this.logger.log(message);
  }

  private safeJson(value: unknown): string {
    try {
      return JSON.stringify(value, (_key, item) =>
        typeof item === 'bigint' ? item.toString() : item,
      );
    } catch {
      return '{"serialization":"failed"}';
    }
  }
}
