                                                               
import { Injectable, Logger } from '@nestjs/common';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { MemoryFacade } from '../../memory/facade/memory.facade';
import { MemoryWriteFrameAdapter } from './memory-write-frame.adapter';
import type { AgentTurnOutcome } from '../../seekmore-agent/contracts/agent-turn.types';
import { WorkflowPostTurnService } from '../../seekmore-workflow/application/workflow-post-turn.service';

@Injectable()
export class ChatPostTurnService {
  private readonly logger = new Logger(ChatPostTurnService.name);

  constructor(
    private readonly trace: RuntimeFlowTraceLogger,
    private readonly memory: MemoryFacade,
    private readonly memoryWriteFrameAdapter: MemoryWriteFrameAdapter,
    private readonly workflowPostTurn: WorkflowPostTurnService,
  ) {}

  async afterTurn(input: {
    traceId: string;
    userId: string;
    agentId: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    userText?: string | null;
    assistantText?: string | null;
    reasonCodes?: string[];
    outcome?: AgentTurnOutcome;
  }): Promise<void> {
    this.logger.debug(
      `[ChatPostTurn] trace=${input.traceId} conv=${input.conversationId} userMsg=${input.userMessageId} assistantMsg=${input.assistantMessageId}`,
    );

    this.trace.event('post_turn.after_turn', {
      trace: input.traceId,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      hasUserText: Boolean(input.userText),
      hasAssistantText: Boolean(input.assistantText),
      reasonCodes: Array.isArray(input.reasonCodes) ? input.reasonCodes.join('|') : null,
    });

    if (input.outcome) {
      await this.workflowPostTurn.afterTurn({
        traceId: input.traceId,
        outcome: input.outcome,
      });
    }

    await this.tryWriteMemory(input);
  }

  private async tryWriteMemory(input: {
    traceId: string;
    userId: string;
    agentId: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    userText?: string | null;
    assistantText?: string | null;
    reasonCodes?: string[];
    outcome?: AgentTurnOutcome;
  }): Promise<void> {
    const frame = this.memoryWriteFrameAdapter.build(input);

    if (!frame) {
      this.trace.debug('post_turn.memory_write_skipped', {
        trace: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        reason: 'no_explicit_memory_intent',
      });
      return;
    }

    try {
      const result = await this.memory.writeBack({
        user: {
          id: input.userId,
        },
        scope: {
          agentId: input.agentId,
          conversationId: input.conversationId,
        },
        ...frame,
      });

      this.trace.event('post_turn.memory_write_done', {
        trace: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        accepted: result.accepted,
        updated: result.updated,
        skipped: result.skipped,
        deleted: result.deleted,
        decisionCount: result.decisions.length,
      });
    } catch (error) {
      this.trace.warn('post_turn.memory_write_failed', {
        trace: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
