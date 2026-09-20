                                      
import { BadRequestException, Body, Controller, Get, Param, Patch, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { RuntimeTimelineQueryService } from './runtime-events/runtime-timeline-query.service';
import { ChatBootstrapQueryService } from './bootstrap/chat-bootstrap-query.service';
import { RuntimeAccessPolicyService } from '../approval/runtime-access-policy.service';
import { RuntimeApprovalService } from '../approval/runtime-approval.service';
import type { AgentPermissionMode } from '../seekmore-agent/contracts/agent-turn.types';

@Controller('chat')
@UseGuards(JwtGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
    private readonly runtimeTimeline: RuntimeTimelineQueryService,
    private readonly bootstrap: ChatBootstrapQueryService,
    private readonly accessPolicy: RuntimeAccessPolicyService,
    private readonly approvals: RuntimeApprovalService,
  ) {}

                      
  @Get(':agentId/conversation/init')
  async getOrCreateConversation(@Param('agentId') agentId: string, @Req() req: any) {
    const userId = req.user.id;

    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        userId: userId,
      },
    });

    if (!agent) {
      const access = await this.prisma.userAgent.findFirst({
        where: {
          agentId: agentId,
          userId: userId,
        },
      });

      if (!access) {
        throw new ForbiddenException({ code: 'AGENT_ACCESS_DENIED', message: 'You do not have access to this agent' });
      }
    }

    const conversation = await this.chatService.getOrCreateConversation(userId, agentId);

    return {
      code: 0,
      message: 'success',
      data: {
        conversationId: conversation.id,
      },
    };
  }

  @Get(':conversationId/runtime-timeline')
  async getRuntimeTimeline(
    @Param('conversationId') conversationId: string,
    @Query('afterSequence') afterSequence: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('mode') mode: string | undefined,
    @Req() req: any,
  ) {
    const data = mode === 'snapshot' || !afterSequence?.trim()
      ? await this.runtimeTimeline.snapshot({
          userId: req.user.id,
          conversationId,
        })
      : await this.runtimeTimeline.replay({
          userId: req.user.id,
          conversationId,
          afterSequence: afterSequence.trim(),
          limit: Math.min(1000, Math.max(1, Number(limit ?? 500) || 500)),
        });
    return { code: 0, message: 'success', data };
  }

              
  @Get(':conversationId/bootstrap')
  async getBootstrap(
    @Param('conversationId') conversationId: string,
    @Query('agentId') rawAgentId: string | undefined,
    @Req() req: any,
  ) {
    const agentId = String(rawAgentId ?? '').trim();
    if (!agentId) throw new BadRequestException('CHAT_BOOTSTRAP_AGENT_ID_REQUIRED');
    const data = await this.bootstrap.query({
      userId: req.user.id,
      agentId,
      conversationId,
    });
    return { code: 0, message: 'success', data };
  }


  @Patch(':conversationId/runtime-settings')
  async updateRuntimeSettings(
    @Param('conversationId') conversationId: string,
    @Body() body: {
      workspaceId?: string | null;
      permissionMode?: AgentPermissionMode;
    },
    @Req() req: any,
  ) {
    const data = await this.accessPolicy.updateConversationSettings({
      userId: req.user.id,
      conversationId,
      ...(Object.prototype.hasOwnProperty.call(body ?? {}, 'workspaceId')
        ? { workspaceId: body?.workspaceId ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body ?? {}, 'permissionMode')
        ? { permissionMode: body?.permissionMode }
        : {}),
    });
    await this.approvals.reconcilePendingForConversation({
      userId: req.user.id,
      conversationId,
    });
    return { code: 0, message: 'success', data };
  }

  @Get(':conversationId/messages')
  async getMessages(@Param('conversationId') conversationId: string, @Req() req: any) {
    const userId = req.user.id; 
    const messages = await this.chatService.getMessagesByConversation(userId, conversationId);
    return {
      code: 0,
      message: 'success',
      data: { messages },
    };
  }
}
    
