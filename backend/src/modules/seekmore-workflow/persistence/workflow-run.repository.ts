import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { AgentPermissionMode } from '../../seekmore-agent/contracts/agent-turn.types';
import type {
  WorkflowContinuationMode,
  WorkflowContract,
  WorkflowRunSnapshot,
  WorkflowRunStatus,
  WorkflowWaitReason,
} from '../contracts/workflow-run.types';
import { WorkflowTransitionPolicy } from '../domain/workflow-transition.policy';

export type WorkflowDbClient = Prisma.TransactionClient | PrismaService;
export interface WorkflowConversationScope {
  userId: string;
  agentId: string;
  conversationId: string;
}

const OPEN_STATUSES: WorkflowRunStatus[] = ['RUNNING', 'WAITING', 'BLOCKED'];

@Injectable()
export class WorkflowRunRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: WorkflowTransitionPolicy,
  ) {}

  async create(client: WorkflowDbClient, input: {
    id: string;
    userId: string;
    agentId: string;
    conversationId: string;
    branchId: string | null;
    workspaceId: string | null;
    initialUserMessageId: string;
    inputObjectIds: string[];
    title: string;
    goal: string;
    contract: WorkflowContract;
    continuationMode: WorkflowContinuationMode;
    permissionMode: AgentPermissionMode;
  }): Promise<WorkflowRunSnapshot> {
    const row = await (client as any).workflowRun.create({ data: {
      id: input.id,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      branchId: input.branchId,
      workspaceId: input.workspaceId,
      initialUserMessageId: input.initialUserMessageId,
      inputObjectIds: input.inputObjectIds,
      title: input.title,
      goal: input.goal,
      contractJson: input.contract,
      status: 'RUNNING',
      continuationMode: input.continuationMode,
      permissionMode: input.permissionMode,
    }});
    return this.map(row);
  }

  async findActiveByConversation(input: WorkflowConversationScope, client: WorkflowDbClient = this.prisma): Promise<WorkflowRunSnapshot | null> {
    const row = await (client as any).workflowRun.findFirst({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        status: { in: OPEN_STATUSES },
        conversation: { deletedAt: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? this.map(row) : null;
  }

  async findLatestByConversation(input: WorkflowConversationScope, client: WorkflowDbClient = this.prisma): Promise<WorkflowRunSnapshot | null> {
    const row = await (client as any).workflowRun.findFirst({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        conversation: { deletedAt: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? this.map(row) : null;
  }

  async findByIdForScope(input: WorkflowConversationScope & { workflowId: string }): Promise<WorkflowRunSnapshot | null> {
    const row = await (this.prisma as any).workflowRun.findFirst({
      where: {
        id: input.workflowId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        conversation: { deletedAt: null },
      },
    });
    return row ? this.map(row) : null;
  }

  async findById(workflowId: string, client: WorkflowDbClient = this.prisma): Promise<WorkflowRunSnapshot | null> {
    const row = await (client as any).workflowRun.findFirst({ where: { id: workflowId, conversation: { deletedAt: null } } });
    return row ? this.map(row) : null;
  }

  async update(client: WorkflowDbClient, input: {
    workflowId: string;
    expectedVersion?: number;
    status?: WorkflowRunStatus;
    waitReason?: WorkflowWaitReason | null;
    continuationMode?: WorkflowContinuationMode;
    permissionMode?: AgentPermissionMode;
    currentPhaseId?: string | null;
    title?: string;
    goal?: string;
    contract?: WorkflowContract;
    workspaceId?: string | null;
    completedAt?: Date | null;
    failedAt?: Date | null;
    cancelledAt?: Date | null;
  }): Promise<WorkflowRunSnapshot> {
    if (input.status !== undefined) {
      const existing = await (client as any).workflowRun.findUnique({ where: { id: input.workflowId } });
      if (!existing) throw new Error('WORKFLOW_NOT_FOUND');
      if (existing.status !== input.status) this.transitions.assertWorkflow(existing.status, input.status);
    }
    const where = input.expectedVersion == null
      ? { id: input.workflowId }
      : { id: input.workflowId, version: input.expectedVersion };
    const data: Record<string, unknown> = { version: { increment: 1 } };
    const pairs: Array<[string, unknown]> = [
      ['status', input.status],
      ['waitReason', input.waitReason],
      ['continuationMode', input.continuationMode],
      ['permissionMode', input.permissionMode],
      ['currentPhaseId', input.currentPhaseId],
      ['title', input.title],
      ['goal', input.goal],
      ['contractJson', input.contract],
      ['workspaceId', input.workspaceId],
      ['completedAt', input.completedAt],
      ['failedAt', input.failedAt],
      ['cancelledAt', input.cancelledAt],
    ];
    for (const [key, value] of pairs) if (value !== undefined) data[key] = value;
    const result = await (client as any).workflowRun.updateMany({ where, data });
    if (result.count !== 1) throw new Error('WORKFLOW_VERSION_CONFLICT');
    const row = await (client as any).workflowRun.findUnique({ where: { id: input.workflowId } });
    return this.map(row);
  }

  async acquireLease(input: { workflowId: string; owner: string; ttlMs: number }): Promise<WorkflowRunSnapshot> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs);
    const result = await (this.prisma as any).workflowRun.updateMany({
      where: {
        id: input.workflowId,
        status: { in: ['RUNNING'] },
        conversation: { deletedAt: null },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: input.owner }],
      },
      data: { leaseOwner: input.owner, leaseExpiresAt: expiresAt, fencingToken: { increment: 1 } },
    });
    if (result.count !== 1) throw new Error('WORKFLOW_LEASE_CONFLICT');
    const row = await (this.prisma as any).workflowRun.findUnique({ where: { id: input.workflowId } });
    return this.map(row);
  }

  async heartbeatLease(input: { workflowId: string; owner: string; fencingToken: bigint; ttlMs: number }): Promise<boolean> {
    const result = await (this.prisma as any).workflowRun.updateMany({
      where: { id: input.workflowId, leaseOwner: input.owner, fencingToken: input.fencingToken },
      data: { leaseExpiresAt: new Date(Date.now() + input.ttlMs) },
    });
    return result.count === 1;
  }

  async releaseLease(input: { workflowId: string; owner: string; fencingToken: bigint }): Promise<void> {
    await (this.prisma as any).workflowRun.updateMany({
      where: { id: input.workflowId, leaseOwner: input.owner, fencingToken: input.fencingToken },
      data: { leaseOwner: null, leaseExpiresAt: null },
    });
  }

  async listRecoverable(now: Date, limit = 50): Promise<WorkflowRunSnapshot[]> {
    const graceBefore = new Date(now.getTime() - Math.max(2_000, Number(process.env.WORKFLOW_RECOVERY_GRACE_MS ?? 5_000)));
    const rows = await (this.prisma as any).workflowRun.findMany({
      where: {
        status: 'RUNNING',
        continuationMode: 'AUTO',
        currentPhaseId: { not: null },
        updatedAt: { lt: graceBefore },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        conversation: { deletedAt: null },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map((row: any) => this.map(row));
  }

  private map(row: any): WorkflowRunSnapshot {
    return {
      id: row.id,
      userId: row.userId,
      agentId: row.agentId,
      conversationId: row.conversationId,
      branchId: row.branchId ?? null,
      workspaceId: row.workspaceId ?? null,
      initialUserMessageId: row.initialUserMessageId,
      inputObjectIds: Array.isArray(row.inputObjectIds) ? row.inputObjectIds : [],
      title: String(row.title ?? ''),
      goal: String(row.goal ?? ''),
      contract: this.contract(row.contractJson),
      status: row.status,
      waitReason: row.waitReason ?? null,
      continuationMode: row.continuationMode,
      permissionMode: row.permissionMode ?? 'confirm_required',
      currentPhaseId: row.currentPhaseId ?? null,
      version: Number(row.version ?? 1),
      leaseOwner: row.leaseOwner ?? null,
      leaseExpiresAt: row.leaseExpiresAt ?? null,
      fencingToken: BigInt(row.fencingToken ?? 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt ?? null,
      failedAt: row.failedAt ?? null,
      cancelledAt: row.cancelledAt ?? null,
    };
  }

  private contract(value: unknown): WorkflowContract {
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    return {
      constraints: Array.isArray(record.constraints) ? record.constraints.map(String).filter(Boolean) : [],
      expectedDeliverables: Array.isArray(record.expectedDeliverables)
        ? record.expectedDeliverables.map(String).filter(Boolean)
        : [],
      metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : {},
    };
  }
}
