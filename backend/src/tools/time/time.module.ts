import { Module } from '@nestjs/common';
import { TimeController } from './time.controller';
import { TimeSchedulerService } from './time-scheduler.service';
import { TimeStoreService } from './time-store.service';
import { TimeService } from './time.service';
import { TimeTool } from './time.tool';

@Module({
  controllers: [TimeController],
  providers: [TimeStoreService, TimeService, TimeSchedulerService, TimeTool],
  exports: [TimeTool],
})
export class TimeModule {}
