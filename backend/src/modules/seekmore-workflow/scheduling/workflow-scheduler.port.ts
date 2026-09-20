export const WORKFLOW_SCHEDULER = Symbol('WORKFLOW_SCHEDULER');

export type WorkflowScheduleReason =
  | 'auto_continue'
  | 'user_resume'
  | 'recovery';

export interface WorkflowScheduleRequest {
  workflowId: string;
  phaseId: string;
  requestedAt: string;
  reason: WorkflowScheduleReason;
  sourceTraceId?: string | null;
  expectedWorkflowVersion?: number | null;
}

export interface WorkflowSchedulerPort {
  enqueue(request: WorkflowScheduleRequest): Promise<void>;
  remove(workflowId: string, phaseIds: string[]): Promise<void>;
  subscribe(handler: (request: WorkflowScheduleRequest) => void | Promise<void>): () => void;
}
