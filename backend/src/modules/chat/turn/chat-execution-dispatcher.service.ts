                                                             

import { Injectable } from '@nestjs/common';

import type {
  AgentTurnExecutionInput,
  AgentTurnExecutionResult,
} from '../../seekmore-agent/contracts/agent-turn.types';
import { SeekmoreWorkflowFacade } from '../../seekmore-workflow/application/seekmore-workflow.facade';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import { ChatStreamRunner } from './chat-stream-runner.service';

@Injectable()
export class ChatExecutionDispatcher {
  constructor(
    private readonly workflow: SeekmoreWorkflowFacade,
    private readonly standard: ChatStreamRunner,
    private readonly trace: RuntimeFlowTraceLogger,
  ) {}

  async run(
    input: AgentTurnExecutionInput,
  ): Promise<AgentTurnExecutionResult> {
    throwIfAborted(input.abortSignal);

    this.trace.event(
      'chat.execution_dispatch_start',
      {
        trace: input.traceId,
        conversationId: input.conversationId,
        assistantMessageId:
          input.assistantMessageId,
      },
    );

    const preparedInput =
      await this.workflow.prepareTurn(input);

    throwIfAborted(input.abortSignal);

    const workflowContext = record(
      record(
        preparedInput.externalContext,
      ).seekmoreWorkflow,
    );

    const runtimeToolNames =
      preparedInput.runtimeOptions
        ?.runtimeToolNames
        ?.filter(
          (
            toolName,
          ): toolName is string =>
            typeof toolName === 'string',
        )
      ?? [];

    const runtimeToolNamesValue =
      runtimeToolNames.join(',') || 'none';

    this.trace.event(
      'workflow.dispatch_prepared',
      {
        trace: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId:
          input.conversationId,
        assistantMessageId:
          input.assistantMessageId,
        preparedInputChanged:
          preparedInput !== input,
        runtimeToolNames:
          runtimeToolNamesValue,
        runtimeToolCount:
          runtimeToolNames.length,
        workflowContextPresent:
          Object.keys(workflowContext)
            .length > 0,
        workflowActive:
          typeof workflowContext.active
          === 'boolean'
            ? workflowContext.active
            : null,
        workflowId:
          typeof record(
            workflowContext.workflow,
          ).id === 'string'
            ? record(
                workflowContext.workflow,
              ).id
            : null,
        protocolPresent:
          Object.keys(record(workflowContext.protocol)).length > 0,
      },
    );

    throwIfAborted(input.abortSignal);

    this.trace.event(
      'chat.execution_dispatch_standard',
      {
        trace: input.traceId,
        conversationId:
          input.conversationId,
        assistantMessageId:
          input.assistantMessageId,
        runtimeToolNames:
          runtimeToolNamesValue,
      },
    );

    return this.standard.run(
      preparedInput,
    );
  }
}

function record(
  value: unknown,
): Record<string, any> {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function throwIfAborted(
  signal?: AbortSignal,
): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error(
    'CHAT_TURN_CANCELLED',
  );

  error.name = 'AbortError';

  throw error;
}