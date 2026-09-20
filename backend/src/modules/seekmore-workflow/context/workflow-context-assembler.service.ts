import { Injectable } from '@nestjs/common';
import type { WorkflowTurnContext } from '../contracts/workflow-context.types';
import type { WorkflowPhaseSnapshot } from '../contracts/workflow-phase.types';
import type { WorkflowRunSnapshot } from '../contracts/workflow-run.types';

@Injectable()
export class WorkflowContextAssemblerService {
  build(
    run: WorkflowRunSnapshot,
    phases: WorkflowPhaseSnapshot[],
    trigger: 'USER' | 'AUTO' | 'RESUME' | 'RECOVERY' = 'USER',
  ): WorkflowTurnContext {
    const ordered = [...phases].sort((a, b) => a.position - b.position);
    const byId = new Map(ordered.map((phase) => [phase.id, phase]));
    const current = run.currentPhaseId ? byId.get(run.currentPhaseId) ?? null : null;
    const currentIndex = current ? ordered.findIndex((phase) => phase.id === current.id) : -1;
    const nearbyIds = new Set<string>();

    if (current) {
      nearbyIds.add(current.id);
      if (current.parentPhaseId) nearbyIds.add(current.parentPhaseId);
      for (const dependencyId of current.dependencyIds) nearbyIds.add(dependencyId);
      for (const child of ordered.filter((phase) => phase.parentPhaseId === current.id)) {
        nearbyIds.add(child.id);
      }
    }
    const positional = currentIndex >= 0
      ? ordered.slice(Math.max(0, currentIndex - 2), currentIndex + 4)
      : ordered.slice(0, 5);
    for (const phase of positional) nearbyIds.add(phase.id);

    return {
      active: true,
      workflow: {
        id: run.id,
        title: run.title,
        goal: run.goal,
        status: run.status,
        waitReason: run.waitReason,
        continuationMode: run.continuationMode,
        constraints: run.contract.constraints,
        expectedDeliverables: run.contract.expectedDeliverables,
      },
      currentPhase: current ? {
        id: current.id,
        title: current.title,
        description: current.description,
        status: current.status,
        acceptanceCriteria: current.acceptanceCriteria,
      } : null,
      completedPhaseSummaries: ordered
        .filter((phase) => phase.status === 'COMPLETED')
        .slice(-8)
        .map((phase) => ({ id: phase.id, title: phase.title, summary: phase.resultSummary })),
      nearbyPhases: ordered
        .filter((phase) => nearbyIds.has(phase.id))
        .map((phase) => ({ id: phase.id, title: phase.title, status: phase.status })),
      protocol: {
        requiredClosure: trigger !== 'USER',
        closureActions: [
          'workflow.update',
          'workflow.complete',
          'workflow.block',
          'workflow.control',
        ],
        checkpointActions: ['workflow.update'],
        terminalActions: ['workflow.complete', 'workflow.block', 'workflow.control'],
        userTurnDirectContinuation: trigger === 'USER',
        missingClosureState: 'WAITING',
      },
    };
  }
}
