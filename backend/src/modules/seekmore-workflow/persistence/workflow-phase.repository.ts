import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import type {
  WorkflowPhaseCreateInput,
  WorkflowPhasePatch,
  WorkflowPhaseSnapshot,
  WorkflowPhaseStatus,
} from '../contracts/workflow-phase.types';
import type { WorkflowDbClient } from './workflow-run.repository';

@Injectable()
export class WorkflowPhaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(client: WorkflowDbClient, phases: WorkflowPhaseCreateInput[]): Promise<void> {
    if (!phases.length) return;
    await (client as any).workflowPhase.createMany({ data: phases.map((phase) => ({
      id: phase.id,
      workflowId: phase.workflowId,
      parentPhaseId: phase.parentPhaseId,
      title: phase.title,
      description: phase.description,
      status: phase.status,
      position: phase.position,
      dependencyIds: phase.dependencyIds,
      acceptanceJson: phase.acceptanceCriteria,
      startedAt: phase.status === 'ACTIVE' ? new Date() : null,
    })) });
  }

  async create(client: WorkflowDbClient, phase: WorkflowPhaseCreateInput): Promise<WorkflowPhaseSnapshot> {
    const row = await (client as any).workflowPhase.create({ data: {
      id: phase.id,
      workflowId: phase.workflowId,
      parentPhaseId: phase.parentPhaseId,
      title: phase.title,
      description: phase.description,
      status: phase.status,
      position: phase.position,
      dependencyIds: phase.dependencyIds,
      acceptanceJson: phase.acceptanceCriteria,
      startedAt: phase.status === 'ACTIVE' ? new Date() : null,
    }});
    return this.map(row);
  }

  async listByWorkflow(workflowId: string, client: WorkflowDbClient = this.prisma): Promise<WorkflowPhaseSnapshot[]> {
    const rows = await (client as any).workflowPhase.findMany({
      where: { workflowId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row: any) => this.map(row));
  }

  async findById(phaseId: string, client: WorkflowDbClient = this.prisma): Promise<WorkflowPhaseSnapshot | null> {
    const row = await (client as any).workflowPhase.findUnique({ where: { id: phaseId } });
    return row ? this.map(row) : null;
  }

  async update(client: WorkflowDbClient, patch: WorkflowPhasePatch): Promise<WorkflowPhaseSnapshot> {
    const data: Record<string, unknown> = {};
    const pairs: Array<[string, unknown]> = [
      ['title', patch.title],
      ['description', patch.description],
      ['parentPhaseId', patch.parentPhaseId],
      ['dependencyIds', patch.dependencyIds],
      ['position', patch.position],
      ['acceptanceJson', patch.acceptanceCriteria],
    ];
    for (const [key, value] of pairs) if (value !== undefined) data[key] = value;
    const row = await (client as any).workflowPhase.update({ where: { id: patch.phaseId }, data });
    return this.map(row);
  }

  async setStatus(client: WorkflowDbClient, input: {
    phaseId: string;
    status: WorkflowPhaseStatus;
    resultSummary?: string | null;
    result?: unknown | null;
  }): Promise<WorkflowPhaseSnapshot> {
    const data: Record<string, unknown> = {
      status: input.status,
      resultSummary: input.resultSummary,
      resultJson: input.result,
    };
    if (input.status === 'ACTIVE') {
      const existing = await (client as any).workflowPhase.findUnique({
        where: { id: input.phaseId },
        select: { startedAt: true },
      });
      if (!existing?.startedAt) data.startedAt = new Date();
    }
    if (input.status === 'COMPLETED' || input.status === 'SKIPPED' || input.status === 'FAILED' || input.status === 'CANCELLED') {
      data.completedAt = new Date();
    }
    const row = await (client as any).workflowPhase.update({ where: { id: input.phaseId }, data });
    return this.map(row);
  }

  async deleteMany(client: WorkflowDbClient, workflowId: string, phaseIds: string[]): Promise<void> {
    if (!phaseIds.length) return;
    await (client as any).workflowPhase.deleteMany({ where: { workflowId, id: { in: phaseIds } } });
  }

  private map(row: any): WorkflowPhaseSnapshot {
    return {
      id: row.id,
      workflowId: row.workflowId,
      parentPhaseId: row.parentPhaseId ?? null,
      title: String(row.title ?? ''),
      description: row.description ?? null,
      status: row.status,
      position: Number(row.position ?? 0),
      dependencyIds: Array.isArray(row.dependencyIds) ? row.dependencyIds.map(String) : [],
      acceptanceCriteria: row.acceptanceJson ?? null,
      resultSummary: row.resultSummary ?? null,
      result: row.resultJson ?? null,
      startedAt: row.startedAt ?? null,
      completedAt: row.completedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
