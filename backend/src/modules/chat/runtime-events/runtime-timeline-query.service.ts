import { Injectable } from '@nestjs/common';
import { RuntimeTimelineEventRepository } from './runtime-timeline-event.repository';

@Injectable()
export class RuntimeTimelineQueryService {
  constructor(private readonly events: RuntimeTimelineEventRepository) {}

  replay(input: {
    userId: string;
    conversationId: string;
    afterSequence?: string | null;
    limit?: number;
  }) {
    return this.events.list(input);
  }

  snapshot(input: { userId: string; conversationId: string }) {
    return this.events.snapshot(input);
  }
}
