import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AutomationService } from './automation.service';
import type { AutomationDeliveryPolicy, AutomationStopPolicy, AutomationTrigger } from './automation.types';

@Controller('automation')
@UseGuards(JwtGuard)
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  async list(
    @CurrentUserId() userId: string,
    @Query('conversationId') conversationId?: string,
    @Query('anchorMessageId') anchorMessageId?: string,
    @Query('status') status?: string,
  ) {
    const items = await this.automation.list({
      userId,
      conversationId: clean(conversationId) || null,
      anchorMessageId: clean(anchorMessageId) || null,
      statuses: clean(status) ? clean(status).split(',') : null,
      limit: 200,
    });
    return { items };
  }

  @Get('conversation/:conversationId/summary')
  summary(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return this.automation.summary(userId, conversationId);
  }

  @Get(':automationId')
  get(
    @CurrentUserId() userId: string,
    @Param('automationId') automationId: string,
  ) {
    return this.automation.get(userId, automationId);
  }

  @Patch(':automationId')
  update(
    @CurrentUserId() userId: string,
    @Param('automationId') automationId: string,
    @Body() body: {
      title?: string;
      instruction?: string;
      trigger?: AutomationTrigger;
      stopPolicy?: AutomationStopPolicy | null;
      deliveryPolicy?: AutomationDeliveryPolicy | null;
    },
  ) {
    return this.automation.update(userId, automationId, body ?? {});
  }

  @Post(':automationId/pause')
  pause(@CurrentUserId() userId: string, @Param('automationId') automationId: string) {
    return this.automation.pause(userId, automationId);
  }

  @Post(':automationId/resume')
  resume(@CurrentUserId() userId: string, @Param('automationId') automationId: string) {
    return this.automation.resume(userId, automationId);
  }

  @Post(':automationId/cancel')
  cancel(
    @CurrentUserId() userId: string,
    @Param('automationId') automationId: string,
    @Body() body: { reason?: string },
  ) {
    return this.automation.cancel(userId, automationId, 'USER', clean(body?.reason) || 'user_cancelled');
  }
}

function clean(value: unknown): string { return String(value ?? '').trim(); }
