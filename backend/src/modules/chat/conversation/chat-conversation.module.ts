                                                                    
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ChatConversationController } from './chat-conversation.controller';
import { ChatConversationService } from './chat-conversation.service';
import { ConversationBranchService } from './branch/conversation-branch.service';
import { ConversationBranchSnapshotService } from './branch/conversation-branch-snapshot.service';
import { ConversationBranchObjectSnapshotService } from './branch/conversation-branch-object-snapshot.service';
import { RuntimeObjectModule } from '../../object-runtime/object/object.module';
import { ConversationPurgeService } from './deletion/conversation-purge.service';
import { StorageDeletionTaskService } from './deletion/storage-deletion-task.service';
import { SeekmoreWorkflowModule } from '../../seekmore-workflow/seekmore-workflow.module';
import { AutomationModule } from '../../automation/automation.module';

@Module({
  imports: [
    PrismaModule,
    RuntimeObjectModule,
    SeekmoreWorkflowModule,
    AutomationModule,
  ],
  controllers: [ChatConversationController],
  providers: [
    ChatConversationService,
    ConversationBranchService,
    ConversationBranchSnapshotService,
    ConversationBranchObjectSnapshotService,
    ConversationPurgeService,
    StorageDeletionTaskService,
  ],
  exports: [ChatConversationService, ConversationBranchService],
})
export class ChatConversationModule {}