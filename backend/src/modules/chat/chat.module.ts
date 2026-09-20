                                          
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

import { RateLimitService } from './app/rate-limit.service';
import { PersistScheduler } from './app/persist.scheduler';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LLMModule } from '../llm/llm.module';
import { ChatConversationModule } from './conversation/chat-conversation.module';

import { TitleWsListener } from './chat-title/title-ws.listener';
import { SeekmoreAgentModule } from '../seekmore-agent/seekmore-agent.module';
import { RuntimeEventsModule } from './runtime-events/runtime-events.module';
import { MemoryModule } from '../memory/memory.module';
import { RuntimeObjectModule } from '../object-runtime/object/object.module';
import { ApprovalModule } from '../approval/approval.module';
import { ChatConversationRepository } from './persistence/chat-conversation.repository';
import { ChatMessageRepository } from './persistence/chat-message.repository';
import { MessageTreeService } from './message-tree/message-tree.service';
import { ChatTurnService } from './turn/chat-turn.service';
import { ChatResponseWriter } from './turn/chat-response-writer.service';
import { ChatStreamRunner } from './turn/chat-stream-runner.service';
import { ChatExecutionDispatcher } from './turn/chat-execution-dispatcher.service';
import { ChatTurnRequestRepository } from './turn/chat-turn-request.repository';
import { ChatTurnExecutionRegistry } from './turn/chat-turn-execution.registry';
import { ChatTurnDeliveryBus } from './turn/chat-turn-delivery.bus';
import { ChatTurnOrchestratorService } from './turn/chat-turn-orchestrator.service';
import { ChatTurnCancellationService } from './turn/chat-turn-cancellation.service';
import { ChatTurnRecoveryService } from './turn/chat-turn-recovery.service';
import { ChatPostTurnService } from './post-turn/chat-post-turn.service';
import { MemoryCommandClassifier } from './post-turn/memory-command-classifier.service';
import { MemoryWriteFrameAdapter } from './post-turn/memory-write-frame.adapter';
import { ChatObjectProjectionService } from './object-projection/chat-object-projection.service';


import { RuntimeTraceModule } from '../../common/trace/runtime-trace.module';
import { SeekmoreWorkflowModule } from '../seekmore-workflow/seekmore-workflow.module';
import { SkillModule } from '../agent/skill/skill.module';
import { RuntimeCancellationModule } from '../runtime-cancellation/runtime-cancellation.module';
import { ChatBootstrapMapper } from './bootstrap/chat-bootstrap.mapper';
import { ChatBootstrapQueryService } from './bootstrap/chat-bootstrap-query.service';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [
    RuntimeTraceModule,
    ConfigModule,
    PrismaModule,
    SeekmoreAgentModule,
    RuntimeEventsModule,
    ApprovalModule,
    LLMModule,
    ChatConversationModule,
    MemoryModule,
    RuntimeObjectModule,
    SeekmoreWorkflowModule,
    SkillModule,
    RuntimeCancellationModule,
    AutomationModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatGateway,
    ChatService,
    ChatConversationRepository,
    ChatMessageRepository,
    MessageTreeService,
    ChatTurnService,
    ChatResponseWriter,
    ChatStreamRunner,
    ChatExecutionDispatcher,
    ChatTurnRequestRepository,
    ChatTurnExecutionRegistry,
    ChatTurnDeliveryBus,
    ChatTurnOrchestratorService,
    ChatTurnCancellationService,
    ChatTurnRecoveryService,
    ChatPostTurnService,
    MemoryCommandClassifier,
    MemoryWriteFrameAdapter,
    ChatObjectProjectionService,
    ChatBootstrapMapper,
    ChatBootstrapQueryService,
    RateLimitService,
    PersistScheduler,
    TitleWsListener,
  ],
  exports: [ChatGateway, ChatTurnService, ChatTurnOrchestratorService, ChatTurnDeliveryBus, MessageTreeService, ChatService, ChatObjectProjectionService],
})
export class ChatModule {}
