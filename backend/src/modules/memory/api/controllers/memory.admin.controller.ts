                                                                        
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../../../common/guards/jwt.guard';
import { CurrentUser, type RequestUser } from '../../../../common/decorators/user.decorator';
import { MemoryFacade } from '../../facade/memory.facade';
import {
  ListMemoryAuditQueryDto,
  ListMemoryManagementQueryDto,
  MemoryMutationDto,
} from '../../contracts/dtos/memory.dto';

@Controller('memory/admin')
@UseGuards(JwtGuard)
export class MemoryAdminController {
  constructor(private readonly memory: MemoryFacade) {}

  @Get('health')
  health() {
    return { ok: true, module: 'memory-kernel' };
  }

  @Get('facts')
  listFacts(@CurrentUser() user: RequestUser, @Query() query: ListMemoryManagementQueryDto) {
    return this.memory.listForManagement({
      user,
      scope: {
        tenantId: query.tenantId ?? null,
        orgId: query.orgId ?? null,
        groupId: query.groupId ?? null,
        planId: query.planId ?? null,
        projectId: query.projectId ?? null,
        agentId: query.agentId ?? null,
        conversationId: query.conversationId ?? null,
      },
      status: query.status ?? 'active',
      scopeLevel: query.scopeLevel as any,
      kind: query.kind as any,
      sensitivity: query.sensitivity as any,
      keyword: query.keyword ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit ?? 50,
    });
  }

  @Get('facts/:memoryId/audit')
  listFactAudit(
    @CurrentUser() user: RequestUser,
    @Param('memoryId') memoryId: string,
    @Query() query: ListMemoryAuditQueryDto,
  ) {
    return this.memory.listAudit({
      user,
      scope: {
        tenantId: query.tenantId ?? null,
        orgId: query.orgId ?? null,
        groupId: query.groupId ?? null,
        planId: query.planId ?? null,
        projectId: query.projectId ?? null,
        agentId: query.agentId ?? null,
        conversationId: query.conversationId ?? null,
      },
      memoryId,
      cursor: query.cursor ?? null,
      limit: query.limit ?? 50,
    });
  }

  @Delete('facts/:memoryId')
  deleteFact(
    @CurrentUser() user: RequestUser,
    @Param('memoryId') memoryId: string,
    @Body() body: MemoryMutationDto,
  ) {
    return this.memory.deleteById({
      user,
      scope: body.scope ?? {},
      memoryId,
      reason: body.reason ?? 'management_delete',
    });
  }

  @Delete('facts/:memoryId/purge')
  purgeFact(
    @CurrentUser() user: RequestUser,
    @Param('memoryId') memoryId: string,
    @Body() body: MemoryMutationDto,
  ) {
    return this.memory.purgeById({
      user,
      scope: body.scope ?? {},
      memoryId,
      reason: body.reason ?? 'management_purge',
    });
  }

  @Post('facts/:memoryId/restore')
  restoreFact(
    @CurrentUser() user: RequestUser,
    @Param('memoryId') memoryId: string,
    @Body() body: MemoryMutationDto,
  ) {
    return this.memory.restoreById({
      user,
      scope: body.scope ?? {},
      memoryId,
      reason: body.reason ?? 'management_restore',
    });
  }

  @Post('facts/:memoryId/promote')
  promoteFact(
    @CurrentUser() user: RequestUser,
    @Param('memoryId') memoryId: string,
    @Body() body: MemoryMutationDto,
  ) {
    return this.memory.promoteById({
      user,
      scope: body.scope ?? {},
      memoryId,
      reason: body.reason ?? 'management_promote',
    });
  }
}