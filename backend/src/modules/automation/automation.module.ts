import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AutomationController } from './automation.controller';
import { AutomationControlBus } from './automation-control.bus';
import { AutomationLifecycleService } from './automation-lifecycle.service';
import { AutomationRealtimeBus } from './automation-realtime.bus';
import { AutomationService } from './automation.service';
import { AutomationTool } from './automation.tool';

@Module({
  imports: [PrismaModule],
  controllers: [AutomationController],
  providers: [
    AutomationLifecycleService,
    AutomationRealtimeBus,
    AutomationControlBus,
    AutomationService,
    AutomationTool,
  ],
  exports: [
    AutomationLifecycleService,
    AutomationRealtimeBus,
    AutomationControlBus,
    AutomationService,
    AutomationTool,
  ],
})
export class AutomationModule {}
