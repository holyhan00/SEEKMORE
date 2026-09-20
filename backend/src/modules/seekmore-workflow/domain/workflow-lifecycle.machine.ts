import { Injectable } from '@nestjs/common';
import type { WorkflowRunStatus } from '../contracts/workflow-run.types';

const TRANSITIONS: Readonly<Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>> = {
  RUNNING: ['WAITING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  WAITING: ['RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  BLOCKED: ['RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

@Injectable()
export class WorkflowLifecycleMachine {
  canTransition(from: WorkflowRunStatus, to: WorkflowRunStatus): boolean {
    return from === to || TRANSITIONS[from].includes(to);
  }

  assertTransition(from: WorkflowRunStatus, to: WorkflowRunStatus): void {
    if (!this.canTransition(from, to)) {
      throw new Error(`WORKFLOW_INVALID_TRANSITION:${from}->${to}`);
    }
  }
}
