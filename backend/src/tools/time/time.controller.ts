import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { TimeService } from './time.service';

@Controller('time')
@UseGuards(JwtGuard)
export class TimeController {
  constructor(private readonly time: TimeService) {}

  @Get('snapshot')
  snapshot(
    @CurrentUserId() userId: string,
    @Query('timezone') timezone?: string,
  ) {
    return this.time.snapshot(
      userId,
      String(timezone ?? '').trim() || null,
    );
  }

  @Get('items')
  listItems(
    @CurrentUserId() userId: string,
    @Query('conversationId') conversationId?: string,
    @Query('includeCompleted') includeCompleted?: string,
    @Query('limit') limit?: string,
    @Query('timezone') timezone?: string,
  ) {
    return this.time.list(userId, {
      conversationId: String(conversationId ?? '').trim() || null,
      includeCompleted: includeCompleted === 'true',
      limit: this.number(limit, 50),
      timezone: String(timezone ?? '').trim() || null,
    });
  }

  @Get('notifications')
  listNotifications(
    @CurrentUserId() userId: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return this.time.listNotifications(userId, {
      unreadOnly: unreadOnly !== 'false',
      limit: this.number(limit, 50),
    });
  }

  @Post('items/:itemId/action')
  action(
    @CurrentUserId() userId: string,
    @Param('itemId') itemId: string,
    @Body() body: { action?: string; snoozeMs?: number },
  ) {
    const action = String(body?.action ?? '').trim();
    if (!['pause', 'resume', 'stop', 'complete', 'cancel', 'snooze'].includes(action)) {
      return { ok: false, error: { code: 'TIME_ACTION_UNSUPPORTED', message: 'Unsupported item action' } };
    }
    return this.time.applyItemAction(
      userId,
      itemId,
      action as 'pause' | 'resume' | 'stop' | 'complete' | 'cancel' | 'snooze',
      body?.snoozeMs,
    );
  }

  @Post('notifications/:notificationId/ack')
  acknowledge(
    @CurrentUserId() userId: string,
    @Param('notificationId') notificationId: string,
  ) {
    return this.time.acknowledgeNotification(userId, notificationId);
  }

  private number(value: string | undefined, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(1, Math.min(Math.floor(numeric), 100)) : fallback;
  }
}
