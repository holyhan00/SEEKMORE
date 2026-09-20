import { Injectable } from '@nestjs/common';

export interface ActiveChatTurnExecution {
  requestId: string;
  traceId: string;
  userId: string;
  agentId: string;
  conversationId: string;
  controller: AbortController;
  startedAt: number;
}

@Injectable()
export class ChatTurnExecutionRegistry {
  private readonly byTrace = new Map<string, ActiveChatTurnExecution>();
  private readonly traceByConversation = new Map<string, string>();

  begin(input: Omit<ActiveChatTurnExecution, 'controller' | 'startedAt'>): ActiveChatTurnExecution {
    if (this.traceByConversation.has(input.conversationId)) {
      throw new Error('CHAT_TURN_ALREADY_ACTIVE');
    }
    const execution: ActiveChatTurnExecution = {
      ...input,
      controller: new AbortController(),
      startedAt: Date.now(),
    };
    this.byTrace.set(input.traceId, execution);
    this.traceByConversation.set(input.conversationId, input.traceId);
    return execution;
  }

  currentByConversation(conversationId: string): ActiveChatTurnExecution | null {
    const traceId = this.traceByConversation.get(conversationId);
    return traceId ? this.byTrace.get(traceId) ?? null : null;
  }

  currentByTrace(traceId: string): ActiveChatTurnExecution | null {
    return this.byTrace.get(traceId) ?? null;
  }

  requestStop(traceId: string, reason: string): boolean {
    const execution = this.byTrace.get(traceId);
    if (!execution) return false;
    if (!execution.controller.signal.aborted) execution.controller.abort(reason);
    return true;
  }

  finish(traceId: string): void {
    const execution = this.byTrace.get(traceId);
    if (!execution) return;
    this.byTrace.delete(traceId);
    if (this.traceByConversation.get(execution.conversationId) === traceId) {
      this.traceByConversation.delete(execution.conversationId);
    }
  }
}
