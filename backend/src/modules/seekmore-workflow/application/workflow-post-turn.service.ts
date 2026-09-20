import { Injectable } from '@nestjs/common';
import type { AgentTurnOutcome } from '../../seekmore-agent/contracts/agent-turn.types';
import { WorkflowEventRepository } from '../persistence/workflow-event.repository';
import { WorkflowManagerService } from './workflow-manager.service';
import { WorkflowQueryService } from './workflow-query.service';

type WorkflowProtocolAction = 'UPDATE' | 'COMPLETE' | 'BLOCK' | 'CONTROL';

@Injectable()
export class WorkflowPostTurnService {
  constructor(
    private readonly query: WorkflowQueryService,
    private readonly events: WorkflowEventRepository,
    private readonly manager: WorkflowManagerService,
  ) {}

  async afterTurn(input: {
    traceId: string;
    outcome: AgentTurnOutcome;
  }): Promise<void> {
    const linked = await this.query.byTrace(input.traceId);
    if (!linked) return;

    const run = linked.run;
    if (this.isTerminal(run.status)) return;

    if (input.outcome.kind === 'paused') {
      await this.manager.markPausedByAgent({
        run,
        traceId: input.traceId,
        reason: input.outcome.reason,
      });
      return;
    }

    if (
      input.outcome.status === 'failed'
      || input.outcome.status === 'blocked'
      || input.outcome.status === 'cancelled'
    ) {
      if (linked.link.trigger === 'USER') return;
      await this.manager.setWaitingAfterTurn({
        run,
        traceId: input.traceId,
        reason: 'workflow_turn_not_successful',
      });
      return;
    }

    const protocolEvent = await this.events.findLatestProtocolEvent(
      run.id,
      input.traceId,
    );
    const protocolAction = this.protocolAction(protocolEvent?.payload.protocolAction);

    if (!protocolAction) {
      if (linked.link.trigger === 'USER') return;
      if (run.status === 'RUNNING') {
        await this.manager.setWaitingAfterTurn({
          run,
          traceId: input.traceId,
          reason: 'workflow_protocol_action_missing',
        });
      }
      return;
    }

    if (protocolAction === 'BLOCK') return;

    if (protocolAction === 'CONTROL') {
      const controlAction = String(
        protocolEvent?.payload.controlAction ?? '',
      ).trim();
      if (controlAction === 'RESUME' && run.status === 'RUNNING') {
        await this.manager.requestUserResume({
          run,
          traceId: input.traceId,
        });
        return;
      }
      if (run.status === 'RUNNING') {
        await this.manager.setWaitingAfterTurn({
          run,
          traceId: input.traceId,
          reason: 'workflow_control_turn_finished',
        });
      }
      return;
    }

    if (run.status !== 'RUNNING' || !run.currentPhaseId) return;

    if (run.continuationMode === 'AUTO') {
      await this.manager.requestAutoContinuation({
        run,
        traceId: input.traceId,
        protocolAction,
      });
      return;
    }

    await this.manager.setWaitingAfterTurn({
      run,
      traceId: input.traceId,
      reason: 'manual_continuation',
    });
  }

  private protocolAction(value: unknown): WorkflowProtocolAction | null {
    const action = String(value ?? '').trim();
    return action === 'UPDATE'
      || action === 'COMPLETE'
      || action === 'BLOCK'
      || action === 'CONTROL'
      ? action
      : null;
  }

  private isTerminal(status: string): boolean {
    return status === 'COMPLETED'
      || status === 'FAILED'
      || status === 'CANCELLED';
  }
}
