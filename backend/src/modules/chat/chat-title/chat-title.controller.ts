                                                               
import { Body, Controller, Get, Param, Patch, Post, Query, Logger, UseGuards, BadRequestException } from '@nestjs/common';
import { ChatTitleService } from './chat-title.service';
import { EnsureTitleDto, RenameTitleDto, ListByAgentQueryDto, SearchConversationQueryDto } from './title.dto';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../common/guards/jwt.guard';

@Controller('chat/title')
@UseGuards(JwtGuard)
export class ChatTitleController {
  private readonly logger = new Logger(ChatTitleController.name);

  constructor(private readonly svc: ChatTitleService) {}

     
                                                 
                                             
     
  @Post('create')
  async create(
    @CurrentUserId() userId: string,
    @Body() dto: EnsureTitleDto
  ) {
    const conversationId = dto?.conversationId;
    this.logger.debug(
      `[TitleCtrl] create(title only) called: userId=${userId}, conversationId=${conversationId}`,
    );

    if (!conversationId) {
      throw new BadRequestException({
        code: 'CONVERSATION_ID_REQUIRED',
        message: 'conversationId is required. Use /chat/conversation/create to create a new conversation.',
      });
    }

    const ret = await this.svc.ensureTitleFromDB({
      conversationId,
      userId,
   });
    this.logger.log(
      `[TitleCtrl] ensureTitleFromDB result conv=${conversationId} updated=${(ret as any)?.updated} reason=${(ret as any)?.reason || ''}`
    );

    const one = await this.svc.getOne({ conversationId, userId });
    return {
      conversationId: one.id,
      title: one.title,
      agentId: one.agentId,
      createdAt: one.createdAt,
      titleVersion: one.titleVersion,
      titleUpdatedAt: one.titleUpdatedAt,
    };
  }

                                    
  @Post('generate')
  async generateAlias(
    @CurrentUserId() userId: string,
    @Body() dto: EnsureTitleDto
  ) {
    return this.create(userId, dto as any);
  }

  @Patch(':conversationId')
  async rename(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: RenameTitleDto,
  ) {
    this.logger.debug(
      `[TitleCtrl] rename called: userId=${userId}, conversationId=${conversationId}, ver=${dto?.titleVersion}`,
    );
    const updated = await this.svc.rename({
      conversationId,
      userId,
      title: dto.title,
      titleVersion: dto.titleVersion,
    });
    return {
      conversationId: updated.id,
      title: updated.title,
      titleVersion: updated.titleVersion,
      titleUpdatedAt: updated.titleUpdatedAt,
    };
  }

                                      
  @Patch(':conversationId/rename')
  async renameAlias(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: RenameTitleDto,
  ) {
    return this.rename(userId, conversationId, dto);
  }

  @Get('list')
  async list(@CurrentUserId() userId: string, @Query() q: ListByAgentQueryDto) {
    this.logger.debug(
      `[TitleCtrl] list called: userId=${userId}, agentId=${q?.agentId}, cursor=${q?.cursor}, limit=${q?.limit}`,
    );
    const { items, nextCursor } = await this.svc.listByAgent({
      userId,
      agentId: q.agentId,
      cursor: q.cursor ?? null,
      limit: q.limit ?? 20,
    });
    return { items, nextCursor };
  }

                               
  @Get()
  async listAlias(@CurrentUserId() userId: string, @Query() q: ListByAgentQueryDto) {
    return this.list(userId, q);
  }


  @Get('search')
  async search(
    @CurrentUserId() userId: string,
    @Query() q: SearchConversationQueryDto,
  ) {
    return this.svc.search({
      userId,
      query: q.q,
      limit: q.limit ?? 20,
    });
  }

  @Get(':conversationId')
  async one(@CurrentUserId() userId: string, @Param('conversationId') conversationId: string) {
    this.logger.debug(`[TitleCtrl] one called: userId=${userId}, conversationId=${conversationId}`);
    const conv = await this.svc.getOne({ conversationId, userId });
    return conv;
  }
}