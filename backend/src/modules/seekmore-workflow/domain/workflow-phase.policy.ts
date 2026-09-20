import { Injectable } from '@nestjs/common';
import type { WorkflowPhaseCreateInput, WorkflowPhaseSnapshot } from '../contracts/workflow-phase.types';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED']);
const SATISFIED_DEPENDENCY = new Set(['COMPLETED', 'SKIPPED']);

type WorkflowPhaseTreeNode = {
  id: string;
  parentPhaseId: string | null;
};

@Injectable()
export class WorkflowPhasePolicy {
  validateGraph(phases: WorkflowPhaseCreateInput[]): void {
    if (!phases.length) throw new Error('WORKFLOW_PHASES_REQUIRED');
    const ids = new Set(phases.map((phase) => phase.id));
    if (ids.size !== phases.length) throw new Error('WORKFLOW_PHASE_ID_DUPLICATED');

    for (const phase of phases) {
      if (!phase.title.trim()) throw new Error('WORKFLOW_PHASE_TITLE_REQUIRED');
      if (phase.parentPhaseId && !ids.has(phase.parentPhaseId)) {
        throw new Error(`WORKFLOW_PHASE_PARENT_NOT_FOUND:${phase.id}`);
      }
      if (phase.parentPhaseId === phase.id) {
        throw new Error(`WORKFLOW_PHASE_PARENT_CYCLE:${phase.id}`);
      }
      for (const dependencyId of phase.dependencyIds) {
        if (!ids.has(dependencyId)) {
          throw new Error(`WORKFLOW_PHASE_DEPENDENCY_NOT_FOUND:${phase.id}:${dependencyId}`);
        }
        if (dependencyId === phase.id) {
          throw new Error(`WORKFLOW_PHASE_DEPENDENCY_CYCLE:${phase.id}`);
        }
      }
    }

    this.assertAcyclic(
      phases,
      (phase) => phase.parentPhaseId ? [phase.parentPhaseId] : [],
      'WORKFLOW_PHASE_PARENT_CYCLE',
    );
    this.assertAcyclic(
      phases,
      (phase) => phase.dependencyIds,
      'WORKFLOW_PHASE_DEPENDENCY_CYCLE',
    );
  }

  firstExecutable(phases: WorkflowPhaseCreateInput[]): WorkflowPhaseCreateInput | null {
    const containerIds = this.collectContainerIds(phases);
    return [...phases]
      .filter((phase) => phase.status === 'PENDING')
      .filter((phase) => !containerIds.has(phase.id))
      .filter((phase) => phase.dependencyIds.length === 0)
      .sort((left, right) => left.position - right.position)[0]
      ?? null;
  }

  nextExecutable(phases: WorkflowPhaseSnapshot[]): WorkflowPhaseSnapshot | null {
    const completed = new Set(
      phases
        .filter((phase) => SATISFIED_DEPENDENCY.has(phase.status))
        .map((phase) => phase.id),
    );
    const containerIds = this.collectContainerIds(phases);
    return [...phases]
      .filter((phase) => phase.status === 'PENDING')
      .filter((phase) => !containerIds.has(phase.id))
      .filter((phase) => phase.dependencyIds.every((id) => completed.has(id)))
      .sort(
        (left, right) =>
          left.position - right.position
          || left.createdAt.getTime() - right.createdAt.getTime(),
      )[0]
      ?? null;
  }

  isContainer(phaseId: string, phases: WorkflowPhaseTreeNode[]): boolean {
    return phases.some((phase) => phase.parentPhaseId === phaseId);
  }

  isTerminal(status: string): boolean {
    return TERMINAL.has(status);
  }

  allDone(phases: WorkflowPhaseSnapshot[]): boolean {
    return phases.length > 0 && phases.every((phase) =>
      phase.status === 'COMPLETED'
      || phase.status === 'SKIPPED'
      || phase.status === 'CANCELLED',
    );
  }

  private collectContainerIds(phases: WorkflowPhaseTreeNode[]): Set<string> {
    return new Set(
      phases
        .map((phase) => phase.parentPhaseId)
        .filter((phaseId): phaseId is string => Boolean(phaseId)),
    );
  }

  private assertAcyclic(
    phases: WorkflowPhaseCreateInput[],
    edges: (phase: WorkflowPhaseCreateInput) => string[],
    code: string,
  ): void {
    const byId = new Map(phases.map((phase) => [phase.id, phase]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`${code}:${id}`);
      visiting.add(id);
      const phase = byId.get(id);
      for (const next of phase ? edges(phase) : []) visit(next);
      visiting.delete(id);
      visited.add(id);
    };
    for (const phase of phases) visit(phase.id);
  }
}
