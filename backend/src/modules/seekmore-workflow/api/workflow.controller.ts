import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../common/guards/jwt.guard';
import { WorkflowManagerService } from '../application/workflow-manager.service';
import { WorkflowQueryService } from '../application/workflow-query.service';
import {
  WorkflowActiveQueryDto,
  WorkflowCancelDto,
  WorkflowContinuationModeDto,
  WorkflowEventsQueryDto,
  WorkflowScopeQueryDto,
} from './workflow.dto';

@Controller('seekmore-workflows')
@UseGuards(JwtGuard)
export class WorkflowController {
  constructor(
    private readonly queryService: WorkflowQueryService,
    private readonly manager: WorkflowManagerService,
  ) {}

  @Get('active')
  async active(@CurrentUserId() userId: string, @Query() query: WorkflowActiveQueryDto) {
    return this.response(await this.queryService.active({
      userId,
      agentId: this.required(query.agentId, 'WORKFLOW_AGENT_ID_REQUIRED'),
      conversationId: this.required(query.conversationId, 'WORKFLOW_CONVERSATION_ID_REQUIRED'),
    }));
  }

  @Get('current')
  async current(@CurrentUserId() userId: string, @Query() query: WorkflowActiveQueryDto) {
    return this.response(await this.queryService.current({
      userId,
      agentId: this.required(query.agentId, 'WORKFLOW_AGENT_ID_REQUIRED'),
      conversationId: this.required(query.conversationId, 'WORKFLOW_CONVERSATION_ID_REQUIRED'),
    }));
  }

  @Get(':workflowId')
  async detail(
    @CurrentUserId() userId: string,
    @Param('workflowId') workflowId: string,
    @Query() query: WorkflowScopeQueryDto,
  ) {
    return this.response(await this.queryService.detail({
      workflowId,
      userId,
      agentId: this.required(query.agentId, 'WORKFLOW_AGENT_ID_REQUIRED'),
      conversationId: this.required(query.conversationId, 'WORKFLOW_CONVERSATION_ID_REQUIRED'),
    }));
  }

  @Get(':workflowId/events')
  async events(
    @CurrentUserId() userId: string,
    @Param('workflowId') workflowId: string,
    @Query() query: WorkflowEventsQueryDto,
  ) {
    return this.response(await this.queryService.eventsAfter({
      workflowId,
      userId,
      agentId: this.required(query.agentId, 'WORKFLOW_AGENT_ID_REQUIRED'),
      conversationId: this.required(query.conversationId, 'WORKFLOW_CONVERSATION_ID_REQUIRED'),
      afterSequence: Math.max(0, Number(query.afterSequence ?? 0) || 0),
    }));
  }

  @Post(':workflowId/cancel')
  async cancel(
    @CurrentUserId() userId: string,
    @Param('workflowId') workflowId: string,
    @Body() body: WorkflowCancelDto,
  ) {
    const snapshot = await this.queryService.snapshot({
      workflowId,
      userId,
      agentId: this.required(body.agentId, 'WORKFLOW_AGENT_ID_REQUIRED'),
      conversationId: this.required(body.conversationId, 'WORKFLOW_CONVERSATION_ID_REQUIRED'),
    });
    return this.response(await this.manager.control({
      action: 'CANCEL',
      reason: body.reason?.trim() || 'cancelled_via_api',
      run: snapshot.run,
      traceId: `workflow_api_${randomUUID()}`,
    }));
  }

  @Patch(':workflowId/continuation-mode')
  async continuationMode(
    @CurrentUserId() userId: string,
    @Param('workflowId') workflowId: string,
    @Body() body: WorkflowContinuationModeDto,
  ) {
    if (body.mode !== 'MANUAL' && body.mode !== 'AUTO') {
      throw new Error('WORKFLOW_CONTINUATION_MODE_INVALID');
    }
    const snapshot = await this.queryService.snapshot({
      workflowId,
      userId,
      agentId: this.required(body.agentId, 'WORKFLOW_AGENT_ID_REQUIRED'),
      conversationId: this.required(body.conversationId, 'WORKFLOW_CONVERSATION_ID_REQUIRED'),
    });
    return this.response(await this.manager.control({
      action: 'SET_CONTINUATION',
      continuationMode: body.mode,
      reason: 'changed_via_api',
      run: snapshot.run,
      traceId: `workflow_api_${randomUUID()}`,
    }));
  }

  private required(value: unknown, code: string): string {
    const text = String(value ?? '').trim();
    if (!text) throw new Error(code);
    return text;
  }

  private response(data: unknown) {
    return { code: 0, message: 'success', data: this.serialize(data) };
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
  }
}
