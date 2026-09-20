import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MemoryLogger {
  private readonly logger = new Logger('MemoryKernel');

  event(stage: string, fields: Record<string, unknown> = {}) {
    const payload = Object.entries(fields)
      .map(([key, value]) => `${key}=${this.safe(value)}`)
      .join(' ');
    this.logger.log(`stage=${stage}${payload ? ` ${payload}` : ''}`);
  }

  warn(stage: string, fields: Record<string, unknown> = {}) {
    const payload = Object.entries(fields)
      .map(([key, value]) => `${key}=${this.safe(value)}`)
      .join(' ');
    this.logger.warn(`stage=${stage}${payload ? ` ${payload}` : ''}`);
  }

  private safe(value: unknown) {
    const text = String(value ?? 'null').replace(/\s+/g, ' ').trim();
    return text.length > 260 ? `${text.slice(0, 260)}...<truncated>` : text;
  }
}
