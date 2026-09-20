export type GrowLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface GrowLogRecord {
  level: GrowLogLevel;
  event: string;
  message: string;
  fields?: Record<string, unknown>;
}

export interface GrowLoggerPort {
  log(record: GrowLogRecord): void;
}
