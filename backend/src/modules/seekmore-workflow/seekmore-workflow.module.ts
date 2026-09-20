import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RuntimeTraceModule } from '../../common/trace/runtime-trace.module';
import { ToolsCoreModule } from '../../tools/tools.core.module';
import { SeekmoreAgentModule } from '../seekmore-agent/seekmore-agent.module';
import { RuntimeEventsModule } from '../chat/runtime-events/runtime-events.module';
import { RedisModule } from '../redis/redis.module';
import { WorkflowController } from './api/workflow.controller';
import { SeekmoreWorkflowFacade } from './application/seekmore-workflow.facade';
import { WorkflowConversationCleanupService } from './application/workflow-conversation-cleanup.service';
import { WorkflowManagerService } from './application/workflow-manager.service';
import { WorkflowPostTurnService } from './application/workflow-post-turn.service';
import { WorkflowQueryService } from './application/workflow-query.service';
import { WorkflowContextAssemblerService } from './context/workflow-context-assembler.service';
import { WorkflowLifecycleMachine } from './domain/workflow-lifecycle.machine';
import { WorkflowPhasePolicy } from './domain/workflow-phase.policy';
import { WorkflowTransitionPolicy } from './domain/workflow-transition.policy';
import { WorkflowEventPublisher } from './events/workflow-event.publisher';
import { WorkflowRealtimeBus } from './events/workflow-realtime.bus';
import { WorkflowRuntimeToolsService } from './execution/workflow-runtime-tools.service';
import { WorkflowEventRepository } from './persistence/workflow-event.repository';
import { WorkflowPhaseRepository } from './persistence/workflow-phase.repository';
import { WorkflowRunRepository } from './persistence/workflow-run.repository';
import { WorkflowTransactionService } from './persistence/workflow-transaction.service';
import { WorkflowTurnLinkRepository } from './persistence/workflow-turn-link.repository';
import { RedisWorkflowSchedulerService } from './scheduling/redis-workflow-scheduler.service';
import { WorkflowAutoTurnService } from './scheduling/workflow-auto-turn.service';
import { WorkflowLeaseService } from './scheduling/workflow-lease.service';
import { WorkflowOutboxDispatcherService } from './scheduling/workflow-outbox-dispatcher.service';
import { WorkflowRecoveryService } from './scheduling/workflow-recovery.service';
import { WORKFLOW_SCHEDULER } from './scheduling/workflow-scheduler.port';

@Module({
  imports: [
    PrismaModule,
    ToolsCoreModule,
    RuntimeTraceModule,
    SeekmoreAgentModule,
    RuntimeEventsModule,
    RedisModule,
  ],
  controllers: [WorkflowController],
  providers: [
    WorkflowLifecycleMachine,
    WorkflowTransitionPolicy,
    WorkflowPhasePolicy,
    WorkflowRunRepository,
    WorkflowPhaseRepository,
    WorkflowTurnLinkRepository,
    WorkflowEventRepository,
    WorkflowTransactionService,
    WorkflowContextAssemblerService,
    WorkflowRealtimeBus,
    WorkflowEventPublisher,
    WorkflowManagerService,
    WorkflowQueryService,
    WorkflowPostTurnService,
    WorkflowRuntimeToolsService,
    SeekmoreWorkflowFacade,
    RedisWorkflowSchedulerService,
    { provide: WORKFLOW_SCHEDULER, useExisting: RedisWorkflowSchedulerService },
    WorkflowLeaseService,
    WorkflowAutoTurnService,
    WorkflowRecoveryService,
    WorkflowOutboxDispatcherService,
    WorkflowConversationCleanupService,
  ],
  exports: [
    SeekmoreWorkflowFacade,
    WorkflowQueryService,
    WorkflowPostTurnService,
    WorkflowConversationCleanupService,
    WorkflowTransactionService,
    WorkflowRealtimeBus,
  ],
})
export class SeekmoreWorkflowModule {}
