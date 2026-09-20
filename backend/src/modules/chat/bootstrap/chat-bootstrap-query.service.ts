// backend/src/modules/chat/bootstrap/chat-bootstrap-query.service.ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { WorkflowQueryService } from '../../seekmore-workflow/application/workflow-query.service';
import { ChatService } from '../chat.service';
import { ChatConversationRepository } from '../persistence/chat-conversation.repository';
import { RuntimeTimelineQueryService } from '../runtime-events/runtime-timeline-query.service';
import { ChatTurnOrchestratorService } from '../turn/chat-turn-orchestrator.service';
import { ChatBootstrapMapper } from './chat-bootstrap.mapper';
import { RuntimeAccessPolicyService } from '../../approval/runtime-access-policy.service';
import type { ChatBootstrapResponse } from './chat-bootstrap.types';

@Injectable()
export class ChatBootstrapQueryService {
  constructor(
    private readonly conversations: ChatConversationRepository,
    private readonly chat: ChatService,
    private readonly timeline: RuntimeTimelineQueryService,
    private readonly workflows: WorkflowQueryService,
    private readonly turns: ChatTurnOrchestratorService,
    private readonly accessPolicy: RuntimeAccessPolicyService,
    private readonly mapper: ChatBootstrapMapper,
  ) {}

  async query(input: {
    userId: string;
    agentId: string;
    conversationId: string;
  }): Promise<ChatBootstrapResponse> {
    const conversation = await this.conversations.assertUserAccess({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    if (String(conversation.agentId) !== input.agentId) {
      throw new ForbiddenException('CHAT_BOOTSTRAP_AGENT_MISMATCH');
    }

    const turn = await this.turns.sync(input.userId, input.conversationId);
    const activeAssistantMessageId =
      String(turn.active?.assistantMessageId ?? '').trim() || null;

    const [messages, runtimeTimeline, workflow, runtimeSettings] = await Promise.all([
      this.chat.getBootstrapMessages(
        input.userId,
        input.conversationId,
        activeAssistantMessageId,
      ),
      this.timeline.snapshot({
        userId: input.userId,
        conversationId: input.conversationId,
      }),
      this.workflows.active(input),
      this.accessPolicy.getConversationSettings({
        userId: input.userId,
        conversationId: input.conversationId,
      }),
    ]);

    return this.mapper.map({
      conversationId: input.conversationId,
      messages,
      runtimeTimeline: {
        events: runtimeTimeline.events,
        nextCursor: runtimeTimeline.nextCursor,
      },
      workflow,
      turn,
      runtimeSettings,
      generatedAt: Date.now(),
    });
  }
}
