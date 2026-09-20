import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';
import type { WorkflowPhaseSnapshot } from '../contracts/workflow-phase.types';
import type { WorkflowRunSnapshot } from '../contracts/workflow-run.types';
import type {
  WorkflowRealtimeEvent,
  WorkflowRealtimePhase,
  WorkflowRealtimeReason,
} from './workflow-realtime.types';

@Injectable()
export class WorkflowRealtimeBus implements OnModuleDestroy {
  private readonly subject = new Subject<WorkflowRealtimeEvent>();
  private readonly lastSignatureByWorkflow = new Map<string, string>();
  readonly events$: Observable<WorkflowRealtimeEvent> = this.subject.asObservable();

  constructor(private readonly trace: RuntimeFlowTraceLogger) {}

  publishSnapshot(input: {
    run: WorkflowRunSnapshot;
    phases: WorkflowPhaseSnapshot[];
    reason?: WorkflowRealtimeReason;
    traceId?: string | null;
  }): WorkflowRealtimeEvent | null {
    const phases = [...input.phases]
      .sort((a, b) => a.position - b.position)
      .map((phase) => this.phase(phase));
    const currentPhase = phases.find((phase) => phase.id === input.run.currentPhaseId) ?? null;
    const reason = input.reason ?? 'state_changed';
    const signature = JSON.stringify({
      title: input.run.title,
      goal: input.run.goal,
      status: input.run.status,
      waitReason: input.run.waitReason,
      continuationMode: input.run.continuationMode,
      currentPhaseId: input.run.currentPhaseId,
      phases,
    });
    if (reason === 'state_changed' && this.lastSignatureByWorkflow.get(input.run.id) === signature) return null;
    this.lastSignatureByWorkflow.set(input.run.id, signature);

    const event: WorkflowRealtimeEvent = {
      type: 'workflow:changed',
      eventId: `workflow_event_${randomUUID()}`,
      reason,
      userId: input.run.userId,
      agentId: input.run.agentId,
      conversationId: input.run.conversationId,
      workflowId: input.run.id,
      traceId: input.traceId ?? null,
      status: input.run.status,
      waitReason: input.run.waitReason,
      continuationMode: input.run.continuationMode,
      runVersion: input.run.version,
      updatedAt: input.run.updatedAt.toISOString(),
      phaseCount: phases.length,
      phases,
      currentPhase,
      run: {
        id: input.run.id,
        conversationId: input.run.conversationId,
        workspaceId: input.run.workspaceId,
        title: input.run.title,
        goal: input.run.goal,
        status: input.run.status,
        waitReason: input.run.waitReason,
        continuationMode: input.run.continuationMode,
        currentPhaseId: input.run.currentPhaseId,
        version: input.run.version,
        createdAt: input.run.createdAt.toISOString(),
        updatedAt: input.run.updatedAt.toISOString(),
      },
      createdAt: Date.now(),
    };
    this.trace.event('workflow.realtime_published', {
      trace: event.traceId,
      userId: event.userId,
      agentId: event.agentId,
      conversationId: event.conversationId,
      workflowId: event.workflowId,
      reason: event.reason,
      status: event.status,
      phaseCount: event.phaseCount,
      currentPhaseId: event.currentPhase?.id ?? null,
    });
    this.subject.next(event);
    return event;
  }

  forget(workflowId: string): void {
    this.lastSignatureByWorkflow.delete(String(workflowId ?? '').trim());
  }

  onModuleDestroy(): void {
    this.lastSignatureByWorkflow.clear();
    this.subject.complete();
  }

  private phase(phase: WorkflowPhaseSnapshot): WorkflowRealtimePhase {
    return {
      id: phase.id,
      parentPhaseId: phase.parentPhaseId,
      title: phase.title,
      description: phase.description,
      status: phase.status,
      position: phase.position,
      dependencyIds: [...phase.dependencyIds],
      resultSummary: phase.resultSummary,
    };
  }
}
