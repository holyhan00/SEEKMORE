import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RuntimeEventsModule } from '../chat/runtime-events/runtime-events.module';
import { RuntimeWorkspaceModule } from '../workspace/runtime-workspace.module';
import { RuntimeAccessPolicyEvents } from './runtime-access-policy.events';
import { RuntimeAccessPolicyService } from './runtime-access-policy.service';
import { RuntimeActionRiskService } from './runtime-action-risk.service';
import { RuntimeApprovalService } from './runtime-approval.service';

@Module({
  imports: [PrismaModule, RuntimeEventsModule, RuntimeWorkspaceModule],
  providers: [
    RuntimeAccessPolicyEvents,
    RuntimeAccessPolicyService,
    RuntimeActionRiskService,
    RuntimeApprovalService,
  ],
  exports: [
    RuntimeAccessPolicyEvents,
    RuntimeAccessPolicyService,
    RuntimeActionRiskService,
    RuntimeApprovalService,
  ],
})
export class ApprovalModule {}
