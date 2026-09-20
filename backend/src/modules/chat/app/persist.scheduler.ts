                                                   
import { Injectable } from '@nestjs/common';
import { PERSIST_INTERVAL } from './chat.config';

   
                                
      
                                                                             
   
@Injectable()
export class PersistScheduler {
                                   
  private buffers = new Map<
    string,
    { buffer: string; timer: NodeJS.Timeout | null; onFlush?: (full: string) => Promise<void> }
  >();

  accumulate(
    requestId: string,
    delta: string,
    onFlush: (fullContent: string) => Promise<void>
  ) {
    const entry = this.buffers.get(requestId) ?? { buffer: '', timer: null, onFlush };
    entry.buffer += (delta || '');
    entry.onFlush = onFlush;
    this.buffers.set(requestId, entry);

    if (!entry.timer) {
      entry.timer = setTimeout(() => this.flush(requestId).catch(() => undefined), PERSIST_INTERVAL);
    }
  }

  async flush(requestId: string) {
    const entry = this.buffers.get(requestId);
    if (!entry) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const full = entry.buffer;
    if (full && entry.onFlush) {
      await entry.onFlush(full);
    }
  }

  async flushAndClear(requestId: string) {
    await this.flush(requestId).catch(() => undefined);
    this.buffers.delete(requestId);
  }
}