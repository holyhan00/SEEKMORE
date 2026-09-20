import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SeekmoreAgentModule } from '../seekmore-agent/seekmore-agent.module';
import { ChatModule } from '../chat/chat.module';
import { RuntimeEventsModule } from '../chat/runtime-events/runtime-events.module';
import { RuntimeCancellationModule } from '../runtime-cancellation/runtime-cancellation.module';
import { AutomationModule } from './automation.module';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationRuntimeCancellationService } from './automation-runtime-cancellation.service';
import { AutomationSchedulerService } from './automation-scheduler.service';

@Module({
  imports: [
    PrismaModule,
    AutomationModule,
    SeekmoreAgentModule,
    RuntimeEventsModule,
    RuntimeCancellationModule,
    ChatModule,
  ],
  providers: [
    AutomationRuntimeCancellationService,
    AutomationRunnerService,
    AutomationSchedulerService,
  ],
})
export class AutomationRuntimeModule {}
