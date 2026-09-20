import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { RuntimeAssistantTimelineBus } from './runtime-assistant-timeline.bus';
import { RuntimeTimelineSequenceService } from './runtime-timeline-sequence.service';
import { RuntimeEventBus } from './runtime-event.bus';
import { RuntimeTimelineEventRepository } from './runtime-timeline-event.repository';
import { RuntimeTimelinePublisher } from './runtime-timeline-publisher.service';
import { RuntimeTimelineQueryService } from './runtime-timeline-query.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [RuntimeTimelineSequenceService, RuntimeTimelineEventRepository, RuntimeTimelinePublisher, RuntimeTimelineQueryService, RuntimeAssistantTimelineBus, RuntimeEventBus],
  exports: [RuntimeTimelineSequenceService, RuntimeTimelineEventRepository, RuntimeTimelineQueryService, RuntimeAssistantTimelineBus, RuntimeEventBus],
})
export class RuntimeEventsModule {}
