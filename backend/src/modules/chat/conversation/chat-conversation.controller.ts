                                                                        
import { Body, Controller, Post, UseGuards, Logger, Delete, Get, Param } from '@nestjs/common';
import { JwtGuard } from '../../../common/guards/jwt.guard';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator';
import { ChatConversationService } from './chat-conversation.service';
import { CreateConversationDto } from './create-conv.dto';
import { CreateConversationBranchDto } from './branch/conversation-branch.dto';
import { ConversationBranchService } from './branch/conversation-branch.service';
import { ConversationPurgeService } from './deletion/conversation-purge.service';

@UseGuards(JwtGuard)
@Controller('chat/conversation')
export class ChatConversationController {
  private readonly logger = new Logger(ChatConversationController.name);

  constructor(
    private readonly svc: ChatConversationService,
    private readonly branches: ConversationBranchService,
    private readonly purge: ConversationPurgeService,
  ) {}

                                   
  @Post('create')
  async create(@CurrentUserId() userId: string, @Body() dto: CreateConversationDto) {
    this.logger.debug(`[ConvCtrl] create called user=${userId} agent=${dto.agentId}`);
    const conv = await this.svc.createNew({
      userId,
      agentId: dto.agentId,
      firstMessage: dto.firstMessage ?? '',
    });

                       
    return {
      conversationId: conv.id,
      title: conv.title,
      agentId: conv.agentId,
      createdAt: conv.createdAt,
      titleVersion: conv.titleVersion,
      titleUpdatedAt: conv.titleUpdatedAt,
    };
  }

  @Post(':conversationId/branches')
  createBranch(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateConversationBranchDto,
  ) {
    return this.branches.create({
      userId,
      conversationId,
      fromMessageId: dto.fromMessageId,
      requestId: dto.requestId,
    });
  }

  @Get('recycle-bin')
  recycleBin(@CurrentUserId() userId: string) {
    return this.svc.listRecycleGroups(userId);
  }

  @Get(':conversationId/recycle-messages')
  recycleMessages(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.svc.listRecycledMessages(
      userId,
      conversationId,
    );
  }

  @Post(':conversationId/restore')
  restore(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.svc.restore({
      userId,
      conversationId,
    });
  }

  @Delete(':conversationId/permanent')
  permanentlyDelete(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.purge.permanentlyDeleteOwned(
      userId,
      conversationId,
    );
  }

                                              
  @Delete(':conversationId')
  async remove(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const ret = await this.svc.softDelete({ userId, conversationId });
    return ret;                                       
  }
}