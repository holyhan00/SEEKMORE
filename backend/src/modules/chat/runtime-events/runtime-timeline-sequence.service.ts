import { Injectable } from '@nestjs/common';

@Injectable()
export class RuntimeTimelineSequenceService {
  private readonly sequences = new Map<string, number>();
  private clockOffset = 0;

  next(assistantMessageId: string): number {
    const observed = this.sequences.get(assistantMessageId) ?? 0;
    const wallClock = Date.now() * 1000 + (this.clockOffset++ % 1000);
    const next = Math.max(observed + 1, wallClock);
    this.sequences.set(assistantMessageId, next);
    return next;
  }

  observe(assistantMessageId: string, sequence: number): void {
    this.sequences.set(
      assistantMessageId,
      Math.max(sequence, this.sequences.get(assistantMessageId) ?? 0),
    );
  }

  clear(assistantMessageId: string): void {
    this.sequences.delete(assistantMessageId);
  }
}
