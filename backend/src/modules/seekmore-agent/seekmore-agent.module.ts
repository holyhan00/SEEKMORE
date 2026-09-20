import { ExperienceBuilderService } from './experience/experience-builder.service';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RuntimeTraceModule } from '../../common/trace/runtime-trace.module';
import { ToolsModule } from '../../tools/tools.module';
import { RuntimeWorkspaceModule } from '../workspace/runtime-workspace.module';
import { RuntimeEventsModule } from '../chat/runtime-events/runtime-events.module';
import { ApprovalModule } from '../approval/approval.module';
import { RuntimeObjectModule } from '../object-runtime/object/object.module';
import { MediaAiModule } from '../media-ai/media-ai.module';
import { McpRuntimeModule } from '../mcp/mcp-runtime.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../agent/knowledge/knowledge.module';
import { SeekmoreAgentService } from './seekmore-agent.service';
import { BranchHistoryService } from './context/branch-history.service';
import { AgentProfileContextService } from './context/agent-profile-context.service';
import { ConversationContextService } from './context/conversation-context.service';
import { ConversationLockService } from './session/conversation-lock.service';
import { TurnCancellationService } from './session/turn-cancellation.service';
import { ToolSchemaAdapterService } from './tools/tool-schema-adapter.service';
import { ToolResultAdapterService } from './tools/tool-result-adapter.service';
import { AgentToolRuntimeService } from './tools/agent-tool-runtime.service';
import { AgentTurnRepository } from './persistence/agent-turn.repository';
import { AgentCheckpointRepository } from './persistence/agent-checkpoint.repository';
import { AgentTurnFinalizationService } from './finalization/agent-turn-finalization.service';
import { AgentRuntimeService } from './runtime/agent-runtime.service';
import { AgentLoopService } from './runtime/loop/agent-loop.service';
import { ContextResolverService } from './runtime/context/context-resolver.service';
import { WorldStateResolverService } from './runtime/context/world-state-resolver.service';
import { CapabilityResolverService } from './runtime/tools/capability-resolver.service';
import { TokenEstimatorService } from './runtime/context/token-estimator.service';
import { ToolArgumentRepairService } from './runtime/tools/tool-argument-repair.service';
import { ToolExecutionCoordinatorService } from './runtime/tools/tool-execution-coordinator.service';
import { ToolObservationBuilder } from './runtime/tools/tool-observation.builder';
import { ProgressDetectorService } from './runtime/loop/progress-detector.service';
import { VerificationStopService } from './runtime/verification/verification-stop.service';
import { AgentRuntimeEventProjectorService } from './runtime/events/agent-runtime-event-projector.service';
import { AgentDeliveryCollector } from './runtime/delivery/agent-delivery.collector';
import { ModelGatewayModule } from './runtime/model/model-gateway.module';

@Module({
  imports: [
    PrismaModule,
    RuntimeTraceModule,
    ToolsModule,
    RuntimeWorkspaceModule,
    RuntimeEventsModule,
    ApprovalModule,
    RuntimeObjectModule,
    ModelGatewayModule,
    MediaAiModule,
    McpRuntimeModule,
    MemoryModule,
    KnowledgeModule,
  ],
  providers: [
    ExperienceBuilderService,
    SeekmoreAgentService,
    AgentRuntimeService,
    AgentLoopService,
    BranchHistoryService,
    AgentProfileContextService,
    ConversationContextService,
    ConversationLockService,
    TurnCancellationService,
    ToolSchemaAdapterService,
    ToolResultAdapterService,
    AgentToolRuntimeService,
    AgentTurnRepository,
    AgentCheckpointRepository,
    AgentTurnFinalizationService,
    TokenEstimatorService,
    ContextResolverService,
    WorldStateResolverService,
    CapabilityResolverService,
    ToolArgumentRepairService,
    ToolExecutionCoordinatorService,
    ToolObservationBuilder,
    ProgressDetectorService,
    VerificationStopService,
    AgentDeliveryCollector,
    AgentRuntimeEventProjectorService,
  ],
  exports: [
    ExperienceBuilderService,
    SeekmoreAgentService,
    AgentRuntimeService,
    AgentProfileContextService,
    AgentTurnRepository,
    AgentTurnFinalizationService,
    AgentToolRuntimeService,
    TurnCancellationService,
  ],
})
export class SeekmoreAgentModule {}
