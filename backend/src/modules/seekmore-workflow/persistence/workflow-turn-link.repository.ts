import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { WorkflowDbClient } from './workflow-run.repository';

export type WorkflowTurnTrigger = 'USER' | 'AUTO' | 'RESUME' | 'RECOVERY';

export interface WorkflowTurnLinkSnapshot {
  id: string;
  workflowId: string;
  phaseId: string | null;
  traceId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  trigger: WorkflowTurnTrigger;
  createdAt: Date;
}

@Injectable()
export class WorkflowTurnLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async bind(client: WorkflowDbClient, input: {
    workflowId: string;
    phaseId: string | null;
    traceId: string;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
    trigger?: WorkflowTurnTrigger;
  }): Promise<WorkflowTurnLinkSnapshot> {
    const row = await (client as any).workflowTurnLink.upsert({
      where: { traceId: input.traceId },
      create: {
        workflowId: input.workflowId,
        phaseId: input.phaseId,
        traceId: input.traceId,
        userMessageId: input.userMessageId ?? null,
        assistantMessageId: input.assistantMessageId ?? null,
        trigger: input.trigger ?? 'USER',
      },
      update: {
        workflowId: input.workflowId,
        phaseId: input.phaseId,
        userMessageId: input.userMessageId ?? null,
        assistantMessageId: input.assistantMessageId ?? null,
        trigger: input.trigger ?? 'USER',
      },
    });
    return this.map(row);
  }

  async findByTrace(traceId: string, client: WorkflowDbClient = this.prisma): Promise<WorkflowTurnLinkSnapshot | null> {
    const row = await (client as any).workflowTurnLink.findUnique({ where: { traceId } });
    return row ? this.map(row) : null;
  }

  async findLatestByWorkflow(workflowId: string, client: WorkflowDbClient = this.prisma): Promise<WorkflowTurnLinkSnapshot | null> {
    const row = await (client as any).workflowTurnLink.findFirst({
      where: { workflowId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.map(row) : null;
  }

  private map(row: any): WorkflowTurnLinkSnapshot {
    return {
      id: row.id,
      workflowId: row.workflowId,
      phaseId: row.phaseId ?? null,
      traceId: row.traceId,
      userMessageId: row.userMessageId ?? null,
      assistantMessageId: row.assistantMessageId ?? null,
      trigger: row.trigger,
      createdAt: row.createdAt,
    };
  }
}
