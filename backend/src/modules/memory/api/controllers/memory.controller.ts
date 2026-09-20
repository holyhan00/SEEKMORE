                                                                  
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../../../common/guards/jwt.guard';
import { CurrentUserId } from '../../../../common/decorators/current-user-id.decorator';
import { MemoryFacade } from '../../facade/memory.facade';
import { BuildMemoryContextDto, ListMemoryQueryDto, WriteMemoryDto } from '../../contracts/dtos/memory.dto';

@Controller('memory')
@UseGuards(JwtGuard)
export class MemoryController {
  constructor(private readonly memory: MemoryFacade) {}

  @Post('context')
  buildContext(@CurrentUserId() userId: string, @Body() dto: BuildMemoryContextDto) {
    return this.memory.buildContext({
      user: { id: userId },
      scope: dto.scope,
      query: dto.query,
      maxItems: dto.maxItems,
    });
  }

  @Post('write')
  write(@CurrentUserId() userId: string, @Body() dto: WriteMemoryDto) {
    return this.memory.writeBack({
      user: { id: userId },
      scope: dto.scope,
      intent: dto.intent,
      explicitness: dto.explicitness,
      userText: dto.userText ?? null,
      assistantText: dto.assistantText ?? null,
      source: dto.source,
      confirmedCandidates: dto.confirmedCandidates as any,
    });
  }

  @Get()
  list(@CurrentUserId() userId: string, @Query() query: ListMemoryQueryDto) {
    return this.memory.list({
      user: { id: userId },
      scope: {
        tenantId: query.tenantId ?? null,
        orgId: query.orgId ?? null,
        groupId: query.groupId ?? null,
        planId: query.planId ?? null,
        projectId: query.projectId ?? null,
        agentId: query.agentId ?? null,
        conversationId: query.conversationId ?? null,
      },
      cursor: query.cursor ?? null,
      limit: query.limit ?? 50,
    });
  }
}
