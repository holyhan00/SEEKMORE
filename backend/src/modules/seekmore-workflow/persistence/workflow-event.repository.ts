import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { WorkflowDbClient } from './workflow-run.repository';

export interface WorkflowPersistedEvent {
  eventId: string;
  workflowId: string;
  phaseId: string | null;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  deduplicationKey: string;
  createdAt: Date;
}

@Injectable()
export class WorkflowEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(client: WorkflowDbClient, input: {
    workflowId: string;
    phaseId?: string | null;
    type: string;
    payload?: Record<string, unknown>;
    deduplicationKey: string;
    availableAt?: Date;
  }): Promise<WorkflowPersistedEvent> {
    const existing = await (client as any).workflowEvent.findUnique({
      where: { deduplicationKey: input.deduplicationKey },
    });
    if (existing) return this.map(existing);

    const aggregate = await (client as any).workflowEvent.aggregate({
      where: { workflowId: input.workflowId },
      _max: { sequence: true },
    });
    const sequence = Number(aggregate?._max?.sequence ?? 0) + 1;
    const eventId = `workflow_${randomUUID()}`;
    const payload = input.payload ?? {};
    const row = await (client as any).workflowEvent.create({ data: {
      eventId,
      workflowId: input.workflowId,
      phaseId: input.phaseId ?? null,
      sequence,
      type: input.type,
      payloadJson: payload,
      deduplicationKey: input.deduplicationKey,
    }});
    if (input.type === 'workflow.turn.requested') {
      await (client as any).runtimeEventOutbox.create({ data: {
        eventId,
        eventType: input.type,
        aggregateType: 'seekmore_workflow',
        aggregateId: input.workflowId,
        payloadJson: {
          ...payload,
          workflowId: input.workflowId,
          phaseId: input.phaseId ?? null,
          sequence,
        },
        deduplicationKey: input.deduplicationKey,
        availableAt: input.availableAt ?? new Date(),
      }});
    }
    return this.map(row);
  }

  async findLatestProtocolEvent(
    workflowId: string,
    sourceTraceId: string,
  ): Promise<WorkflowPersistedEvent | null> {
    const rows = await (this.prisma as any).workflowEvent.findMany({
      where: {
        workflowId,
        payloadJson: {
          path: ['sourceTraceId'],
          equals: sourceTraceId,
        },
      },
      orderBy: { sequence: 'desc' },
      take: 20,
    });

    const event = rows
      .map((row: any) => this.map(row))
      .find((item: WorkflowPersistedEvent) => {
        if (item.type === 'workflow.turn.requested') return false;
        const action = String(item.payload.protocolAction ?? '').trim();
        return action === 'UPDATE'
          || action === 'COMPLETE'
          || action === 'BLOCK'
          || action === 'CONTROL';
      });

    return event ?? null;
  }

  async listRecentTurnRequests(limit = 100): Promise<WorkflowPersistedEvent[]> {
    const rows = await (this.prisma as any).workflowEvent.findMany({
      where: { type: 'workflow.turn.requested' },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(500, limit)),
    });
    return rows.map((row: any) => this.map(row));
  }

  async list(workflowId: string, afterSequence = 0, limit = 500): Promise<WorkflowPersistedEvent[]> {
    const rows = await (this.prisma as any).workflowEvent.findMany({
      where: { workflowId, sequence: { gt: afterSequence } },
      orderBy: { sequence: 'asc' },
      take: limit,
    });
    return rows.map((row: any) => this.map(row));
  }

  private map(row: any): WorkflowPersistedEvent {
    return {
      eventId: row.eventId,
      workflowId: row.workflowId,
      phaseId: row.phaseId ?? null,
      sequence: Number(row.sequence),
      type: row.type,
      payload: this.record(row.payloadJson),
      deduplicationKey: row.deduplicationKey,
      createdAt: row.createdAt,
    };
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
