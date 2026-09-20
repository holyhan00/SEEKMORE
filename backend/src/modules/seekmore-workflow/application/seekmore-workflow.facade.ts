import { Injectable, Logger } from '@nestjs/common';
import type { AgentTurnExecutionInput } from '../../seekmore-agent/contracts/agent-turn.types';
import { WorkflowContextAssemblerService } from '../context/workflow-context-assembler.service';
import { WorkflowManagerService } from './workflow-manager.service';
import { WorkflowQueryService } from './workflow-query.service';

@Injectable()
export class SeekmoreWorkflowFacade {
  private readonly logger = new Logger(SeekmoreWorkflowFacade.name);

  constructor(
    private readonly query: WorkflowQueryService,
    private readonly manager: WorkflowManagerService,
    private readonly context: WorkflowContextAssemblerService,
  ) {}

  async prepareTurn(input: AgentTurnExecutionInput): Promise<AgentTurnExecutionInput> {
    const active = await this.query.active({
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
    });

    if (!active) {
      const runtimeToolNames = this.runtimeTools(input, [
        'workflow.start',
        'workflow.update',
        'workflow.complete',
        'workflow.block',
        'workflow.control',
      ]);
      this.logPrepared(input, false, null, runtimeToolNames);
      return {
        ...input,
        runtimeOptions: {
          ...input.runtimeOptions,
          runtimeToolNames,
        },
      };
    }

    const trigger = this.trigger(input);

    await this.manager.bindTurn({
      run: active.run,
      traceId: input.traceId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      trigger,
    });

    const runtimeToolNames = this.runtimeTools(input, [
      'workflow.update',
      'workflow.complete',
      'workflow.block',
      'workflow.control',
    ]);
    const workflowContext = this.context.build(active.run, active.phases, trigger);
    this.logPrepared(input, true, active.run.id, runtimeToolNames);

    return {
      ...input,
      runtimeOptions: {
        ...input.runtimeOptions,
        runtimeToolNames,
      },
      externalContext: {
        ...this.record(input.externalContext),
        seekmoreWorkflow: workflowContext,
      },
    };
  }

  private runtimeTools(input: AgentTurnExecutionInput, workflowTools: string[]): string[] {
    return [
      ...new Set([
        ...(input.runtimeOptions?.runtimeToolNames ?? []),
        ...workflowTools,
      ]),
    ];
  }

  private trigger(input: AgentTurnExecutionInput): 'USER' | 'AUTO' | 'RESUME' | 'RECOVERY' {
    const external = this.record(input.externalContext);
    const source = String(external.source ?? '').trim();
    const reason = String(external.scheduleReason ?? '').trim();
    if (source === 'workflow_auto') {
      if (reason === 'recovery') return 'RECOVERY';
      if (reason === 'user_resume') return 'RESUME';
      return 'AUTO';
    }
    return 'USER';
  }

  private logPrepared(
    input: AgentTurnExecutionInput,
    active: boolean,
    workflowId: string | null,
    runtimeToolNames: string[],
  ): void {
    this.logger.log([
      'stage=workflow.capabilities_prepared',
      `userId=${input.userId}`,
      `agentId=${input.agentId}`,
      `conversationId=${input.conversationId}`,
      `active=${active}`,
      `workflowId=${workflowId ?? 'null'}`,
      `runtimeToolNames=${runtimeToolNames.join(',')}`,
    ].join(' '));
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
