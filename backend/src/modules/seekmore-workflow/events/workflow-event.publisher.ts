import { Injectable } from '@nestjs/common';
import type { WorkflowPhaseSnapshot } from '../contracts/workflow-phase.types';
import type { WorkflowRunSnapshot } from '../contracts/workflow-run.types';
import { WorkflowRealtimeBus } from './workflow-realtime.bus';
import type { WorkflowRealtimeReason } from './workflow-realtime.types';

@Injectable()
export class WorkflowEventPublisher {
  constructor(private readonly realtime: WorkflowRealtimeBus) {}

  publishSnapshot(input: {
    run: WorkflowRunSnapshot;
    phases: WorkflowPhaseSnapshot[];
    reason?: WorkflowRealtimeReason;
    traceId?: string | null;
  }): void {
    this.realtime.publishSnapshot({
      run: input.run,
      phases: input.phases,
      reason: input.reason,
      traceId: input.traceId,
    });
  }
}
