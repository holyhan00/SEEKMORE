import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowEventRepository } from '../persistence/workflow-event.repository';
import { WorkflowPhaseRepository } from '../persistence/workflow-phase.repository';
import { WorkflowRunRepository, type WorkflowConversationScope } from '../persistence/workflow-run.repository';
import { WorkflowTurnLinkRepository } from '../persistence/workflow-turn-link.repository';

export interface WorkflowScopedRequest extends WorkflowConversationScope {
  workflowId: string;
}

@Injectable()
export class WorkflowQueryService {
  constructor(
    private readonly runs: WorkflowRunRepository,
    private readonly phases: WorkflowPhaseRepository,
    private readonly turnLinks: WorkflowTurnLinkRepository,
    private readonly events: WorkflowEventRepository,
  ) {}

  async current(input: WorkflowConversationScope) {
    const run = await this.runs.findActiveByConversation(input)
      ?? await this.runs.findLatestByConversation(input);
    if (!run) return null;
    return this.snapshot({ ...input, workflowId: run.id });
  }

  async active(input: WorkflowConversationScope) {
    const run = await this.runs.findActiveByConversation(input);
    if (!run) return null;
    return this.snapshot({ ...input, workflowId: run.id });
  }

  async snapshot(input: WorkflowScopedRequest) {
    const run = await this.runs.findByIdForScope(input);
    if (!run) throw new NotFoundException('WORKFLOW_NOT_FOUND');
    const phases = await this.phases.listByWorkflow(run.id);
    return {
      run,
      phases,
      currentPhase: phases.find((phase) => phase.id === run.currentPhaseId) ?? null,
    };
  }

  async detail(input: WorkflowScopedRequest) {
    const snapshot = await this.snapshot(input);
    return { ...snapshot };
  }

  async eventsAfter(input: WorkflowScopedRequest & { afterSequence?: number }) {
    const run = await this.runs.findByIdForScope(input);
    if (!run) throw new NotFoundException('WORKFLOW_NOT_FOUND');
    return this.events.list(input.workflowId, Math.max(0, input.afterSequence ?? 0));
  }

  async byTrace(traceId: string) {
    const link = await this.turnLinks.findByTrace(traceId);
    if (!link) return null;
    const run = await this.runs.findById(link.workflowId);
    if (!run) return null;
    const phases = await this.phases.listByWorkflow(run.id);
    return {
      link,
      run,
      phases,
      currentPhase: phases.find((phase) => phase.id === run.currentPhaseId) ?? null,
    };
  }

  async compactActive(input: WorkflowConversationScope): Promise<Record<string, unknown> | null> {
    const active = await this.active(input);
    if (!active) return null;
    return {
      id: active.run.id,
      title: active.run.title,
      goal: active.run.goal,
      status: active.run.status,
      waitReason: active.run.waitReason,
      continuationMode: active.run.continuationMode,
      currentPhaseId: active.run.currentPhaseId,
      version: active.run.version,
      phases: active.phases.map((phase) => ({
        id: phase.id,
        parentPhaseId: phase.parentPhaseId,
        title: phase.title,
        description: phase.description,
        status: phase.status,
        position: phase.position,
        dependencyIds: phase.dependencyIds,
        resultSummary: phase.resultSummary,
      })),
    };
  }
}
