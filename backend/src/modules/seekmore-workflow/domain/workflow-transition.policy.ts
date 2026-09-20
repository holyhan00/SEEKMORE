import { Injectable } from '@nestjs/common';
import type { WorkflowRunStatus } from '../contracts/workflow-run.types';
import { WorkflowLifecycleMachine } from './workflow-lifecycle.machine';

@Injectable()
export class WorkflowTransitionPolicy {
  constructor(private readonly workflow: WorkflowLifecycleMachine) {}

  assertWorkflow(from: WorkflowRunStatus, to: WorkflowRunStatus): void {
    this.workflow.assertTransition(from, to);
  }
}
