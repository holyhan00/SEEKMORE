import { Injectable } from '@nestjs/common';
import type { AgentRuntimeMessage, AgentRuntimeToolCall } from '../../contracts/agent-turn.types';
import type { AgentToolResult } from '../../contracts/agent-tool.types';

@Injectable()
export class ToolObservationBuilder {
  message(call: AgentRuntimeToolCall, result: AgentToolResult): AgentRuntimeMessage {
    return {
      role: 'tool',
      name: call.name,
      toolCallId: call.id,
      content: this.content(result),
    };
  }

  private content(result: AgentToolResult): string {
    if (result.status === 'completed') {
      return result.observation;
    }

    if (result.status === 'requires_confirmation') {
      return JSON.stringify({
        status: 'requires_confirmation',
        approvalId: result.approvalId,
        reason: result.reason,
        actionPreview: result.actionPreview,
      });
    }

    return JSON.stringify({
      status: 'failed',
      errorCode: result.errorCode,
      message: result.message,
      retryable: result.retryable,
      metadata: result.metadata ?? {},
    });
  }
}
