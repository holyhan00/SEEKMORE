import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { RuntimeAssistantTimelineBus } from '../chat/runtime-events/runtime-assistant-timeline.bus';
import type { AgentApprovalDecision, AgentPermissionMode } from '../seekmore-agent/contracts/agent-turn.types';
import type { AgentApprovalRequest } from './agent-approval.types';
import { RuntimeAccessPolicyService } from './runtime-access-policy.service';
import type {
  RuntimeApprovalScopeType,
  RuntimeRiskLevel,
} from './runtime-access-policy.types';
import { RuntimeActionRiskService } from './runtime-action-risk.service';

interface Waiter {
  resolve: (decision: AgentApprovalDecision) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  poller: ReturnType<typeof setInterval>;
  removeAbortListener?: () => void;
}

@Injectable()
export class RuntimeApprovalService {
  private readonly waiters = new Map<string, Waiter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: RuntimeAssistantTimelineBus,
    private readonly accessPolicy: RuntimeAccessPolicyService,
    private readonly risk: RuntimeActionRiskService,
  ) {}

  async request(input: {
    turnId: string;
    traceId: string;
    userId: string;
    agentId: string;
    conversationId: string;
    assistantMessageId: string;
    toolCallId?: string | null;
    toolName: string;
    scopeType: RuntimeApprovalScopeType;
    scopeId: string;
    workflowId: string | null;
    phaseId: string | null;
    stepId: string | null;
    iteration: number | null;
    riskLevel: RuntimeRiskLevel;
    descriptorHash: string;
    policyVersionAtRequest: number;
    permissionMode: AgentPermissionMode;
    actionPreview: unknown;
  }): Promise<AgentApprovalRequest> {
    const approvalId = randomUUID();
    const row = await (this.prisma as any).agentApproval.create({
      data: {
        approvalId,
        turnId: input.turnId,
        traceId: input.traceId,
        userId: input.userId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        toolCallId: input.toolCallId ?? null,
        toolName: input.toolName,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        workflowId: input.workflowId,
        phaseId: input.phaseId,
        stepId: input.stepId,
        iteration: input.iteration,
        riskLevel: input.riskLevel,
        descriptorHash: input.descriptorHash,
        policyVersionAtRequest: input.policyVersionAtRequest,
        permissionMode: input.permissionMode,
        requestJson: { actionPreview: input.actionPreview } as Prisma.InputJsonValue,
      },
    });
    this.publishWaiting(row, input.actionPreview, false);
    return this.toRequest(row);
  }

  async waitForDecision(
    approvalId: string,
    timeoutMs = 10 * 60_000,
    signal?: AbortSignal,
  ): Promise<AgentApprovalDecision> {
    const existing = await (this.prisma as any).agentApproval.findUnique({ where: { approvalId } });
    if (!existing) throw new Error('APPROVAL_NOT_FOUND');
    if (existing.decision) return existing.decision as AgentApprovalDecision;
    if (signal?.aborted) throw new Error('APPROVAL_WAIT_CANCELLED');

    return new Promise<AgentApprovalDecision>((resolve, reject) => {
      const finish = (callback: () => void) => {
        const waiter = this.waiters.get(approvalId);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        clearInterval(waiter.poller);
        waiter.removeAbortListener?.();
        this.waiters.delete(approvalId);
        callback();
      };

      const timer = setTimeout(async () => {
        finish(() => reject(new Error('APPROVAL_EXPIRED')));
        await (this.prisma as any).agentApproval.updateMany({
          where: { approvalId, status: 'pending' },
          data: { status: 'expired', errorJson: { message: 'approval expired' } },
        }).catch(() => undefined);
      }, timeoutMs);

      const pollDecision = async () => {
        const latest = await (this.prisma as any).agentApproval.findUnique({
          where: { approvalId },
        }).catch(() => null);
        if (!latest?.decision) return;
        finish(() => resolve(latest.decision as AgentApprovalDecision));
      };
      const poller = setInterval(() => {
        void pollDecision();
      }, 500);
      poller.unref?.();

      const waiter: Waiter = { resolve, reject, timer, poller };
      this.waiters.set(approvalId, waiter);

      if (signal) {
        const onAbort = async () => {
          finish(() => reject(new Error('APPROVAL_WAIT_CANCELLED')));
          await (this.prisma as any).agentApproval.updateMany({
            where: { approvalId, status: 'pending' },
            data: {
              status: 'cancelled',
              errorJson: { message: 'agent turn cancelled while waiting for approval' },
            },
          }).catch(() => undefined);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        if (signal.aborted) void onAbort();
      }

      void pollDecision();
    });
  }

  async replayActiveForUser(userId: string): Promise<number> {
    const normalizedUserId = String(userId ?? '').trim();
    if (!normalizedUserId) return 0;

    const rows = await (this.prisma as any).agentApproval.findMany({
      where: { userId: normalizedUserId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    let replayed = 0;
    for (const row of rows) {
      if (!this.waiters.has(row.approvalId)) continue;
      const request = this.record(row.requestJson);
      this.publishWaiting(row, request.actionPreview ?? null, true);
      replayed += 1;
    }
    return replayed;
  }

  async load(approvalId: string): Promise<AgentApprovalRequest | null> {
    const row = await (this.prisma as any).agentApproval.findUnique({ where: { approvalId } });
    return row ? this.toRequest(row) : null;
  }

  async decide(input: {
    approvalId: string;
    userId: string;
    decision: AgentApprovalDecision;
    taskRunId?: string | null;
  }): Promise<AgentApprovalRequest | null> {
    const row = await (this.prisma as any).agentApproval.findUnique({
      where: { approvalId: input.approvalId },
    });
    if (!row || row.userId !== input.userId) return null;
    const conversation = await (this.prisma as any).conversation.findFirst({
      where: {
        id: row.conversationId,
        userId: input.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!conversation) throw new Error('CONVERSATION_RECYCLED');
    const taskRunId = String(input.taskRunId ?? '').trim();
    if (taskRunId && taskRunId !== String(row.scopeId)) {
      throw new Error('APPROVAL_TASK_SCOPE_MISMATCH');
    }
    if (row.status !== 'pending') return this.toRequest(row);

    let permissionMode = this.permissionMode(row.permissionMode);
    if (input.decision === 'audit_only' || input.decision === 'full_access_for_task') {
      permissionMode = input.decision === 'audit_only'
        ? 'audit_autorun'
        : 'full_access';
      const updatedTask = await this.accessPolicy.setTaskPermission({
        userId: input.userId,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        permissionMode,
      });
      if (!updatedTask) throw new Error('APPROVAL_TASK_SCOPE_NOT_ACTIVE');
    }

    const resolved = await this.resolvePendingRow({
      row,
      decision: input.decision,
      permissionMode,
      autoResolved: false,
      autoResolutionReason: null,
    });

    if (
      input.decision === 'audit_only'
      || input.decision === 'full_access_for_task'
    ) {
      await this.reconcilePendingForConversation({
        userId: input.userId,
        conversationId: row.conversationId,
      });
    }

    return resolved;
  }

  async reconcilePendingForConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<number> {
    const rows = await (this.prisma as any).agentApproval.findMany({
      where: {
        userId: input.userId,
        conversationId: input.conversationId,
        status: 'pending',
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    let resolved = 0;
    for (const row of rows) {
      const policy = await this.accessPolicy.getTaskPolicy(
        row.scopeType,
        row.scopeId,
        input.userId,
      );
      if (!policy) continue;

      const request = this.record(row.requestJson);
      const actionPreview = this.record(request.actionPreview);
      const requestedWorkspace = this.record(actionPreview.workspace);
      const requestedWorkspaceId = this.optionalText(
        requestedWorkspace.workspaceId,
      );
      if (requestedWorkspaceId !== policy.workspaceId) {
        await this.resolvePendingRow({
          row,
          decision: 'rejected',
          permissionMode: policy.permissionMode,
          autoResolved: true,
          autoResolutionReason: 'workspace_changed',
        });
        resolved += 1;
        continue;
      }

      const decision = this.risk.decide({
        permissionMode: policy.permissionMode,
        assessment: {
          riskLevel: row.riskLevel,
          requiresApproval: true,
          sideEffectClass: 'persisted_approval',
          descriptorHash: row.descriptorHash,
          reasonCodes: ['approval:reconciled_after_policy_change'],
        },
      });
      if (decision === 'REQUIRE_APPROVAL') continue;

      await this.resolvePendingRow({
        row,
        decision: decision === 'BLOCK' ? 'rejected' : 'approved_once',
        permissionMode: policy.permissionMode,
        autoResolved: true,
        autoResolutionReason: 'policy_changed',
      });
      resolved += 1;
    }
    return resolved;
  }

  async markResumed(approvalId: string): Promise<void> {
    await (this.prisma as any).agentApproval.updateMany({
      where: { approvalId },
      data: {
        status: 'resumed',
        resumedAt: new Date(),
      },
    });
  }

  private async resolvePendingRow(input: {
    row: any;
    decision: AgentApprovalDecision;
    permissionMode: AgentPermissionMode;
    autoResolved: boolean;
    autoResolutionReason: 'policy_changed' | 'workspace_changed' | null;
  }): Promise<AgentApprovalRequest> {
    const approved = input.decision !== 'rejected';
    const waiter = this.waiters.get(input.row.approvalId);
    const nextStatus = approved ? 'approved' : 'rejected';
    const changed = await (this.prisma as any).agentApproval.updateMany({
      where: {
        approvalId: input.row.approvalId,
        status: 'pending',
      },
      data: {
        status: nextStatus,
        decision: input.decision,
        permissionMode: input.permissionMode,
        decidedAt: new Date(),
        errorJson: Prisma.JsonNull,
      },
    });
    const updated = await (this.prisma as any).agentApproval.findUnique({
      where: { approvalId: input.row.approvalId },
    });
    if (!updated) throw new Error('APPROVAL_NOT_FOUND');

    if (waiter && updated.decision) {
      clearTimeout(waiter.timer);
      clearInterval(waiter.poller);
      waiter.removeAbortListener?.();
      this.waiters.delete(input.row.approvalId);
      waiter.resolve(updated.decision as AgentApprovalDecision);
    }

    if (changed.count === 1) {
      this.publishResolved(updated, {
        approved,
        decision: input.decision,
        permissionMode: input.permissionMode,
        autoResolved: input.autoResolved,
        autoResolutionReason: input.autoResolutionReason,
      });
    }
    return this.toRequest(updated);
  }

  private publishWaiting(row: any, actionPreview: unknown, replayed: boolean): void {
    this.timeline.publishActivity({
      userId: row.userId,
      conversationId: row.conversationId,
      assistantMessageId: row.assistantMessageId,
      traceId: row.traceId,
      activity: {
        activityId: `approval_${row.approvalId}`,
        assistantMessageId: row.assistantMessageId,
        conversationId: row.conversationId,
        workflowId: row.workflowId ?? null,
        stepId: row.stepId ?? null,
        parentActivityId: row.toolCallId ? `tool_${row.toolCallId}` : null,
        version: 1,
        kind: 'approval',
        operation: row.toolName,
        target: { kind: 'tool', label: row.toolName, resourceId: null },
        status: 'waiting',
        title: 'Approval required',
        presentation: {
          key: 'approval.timeline.waiting.title',
        },
        summary: `Tool ${row.toolName} will perform a controlled operation`,
        summaryPresentation: {
          key: 'approval.timeline.waiting.summary',
          params: { toolId: row.toolName },
        },
        progress: null,
        evidenceRefs: [],
        startedAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Date.now(),
        finishedAt: null,
        createdAt: Date.now(),
        detail: {
          approvalId: row.approvalId,
          taskRunId: row.scopeId,
          scopeType: row.scopeType,
          workflowId: row.workflowId ?? null,
          phaseId: row.phaseId ?? null,
          stepId: row.stepId ?? null,
          iteration: row.iteration ?? null,
          permissionMode: row.permissionMode,
          riskLevel: row.riskLevel,
          descriptorHash: row.descriptorHash,
          policyVersionAtRequest: row.policyVersionAtRequest,
          actionPreview,
          replayed,
        },
      },
    });
  }

  private publishResolved(row: any, input: {
    approved: boolean;
    decision: AgentApprovalDecision;
    permissionMode: AgentPermissionMode;
    autoResolved: boolean;
    autoResolutionReason: 'policy_changed' | 'workspace_changed' | null;
  }): void {
    this.timeline.publishActivity({
      userId: row.userId,
      conversationId: row.conversationId,
      assistantMessageId: row.assistantMessageId,
      traceId: row.traceId,
      activity: {
        activityId: `approval_${row.approvalId}`,
        assistantMessageId: row.assistantMessageId,
        conversationId: row.conversationId,
        workflowId: row.workflowId ?? null,
        stepId: row.stepId ?? null,
        parentActivityId: row.toolCallId ? `tool_${row.toolCallId}` : null,
        version: 2,
        kind: 'approval',
        operation: row.toolName,
        target: { kind: 'tool', label: row.toolName, resourceId: null },
        status: input.approved ? 'succeeded' : 'cancelled',
        title: input.approved ? 'Execution approved' : 'Execution cancelled',
        presentation: {
          key: input.approved
            ? 'approval.timeline.resolved.approved'
            : 'approval.timeline.resolved.cancelled',
        },
        summary: input.autoResolutionReason === 'workspace_changed'
          ? 'The workspace changed, so pending operations for the previous workspace were cancelled'
          : input.autoResolved
            ? 'The approval mode changed, so the current operation was handled under the updated policy'
            : null,
        summaryPresentation: input.autoResolutionReason === 'workspace_changed'
          ? { key: 'approval.timeline.resolved.workspaceChanged' }
          : input.autoResolved
            ? { key: 'approval.timeline.resolved.policyChanged' }
            : null,
        progress: null,
        evidenceRefs: [],
        startedAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Date.now(),
        finishedAt: Date.now(),
        createdAt: Date.now(),
        detail: {
          approvalId: row.approvalId,
          taskRunId: row.scopeId,
          scopeType: row.scopeType,
          workflowId: row.workflowId ?? null,
          phaseId: row.phaseId ?? null,
          stepId: row.stepId ?? null,
          iteration: row.iteration ?? null,
          decision: input.decision,
          permissionMode: input.permissionMode,
          autoResolved: input.autoResolved,
          autoResolutionReason: input.autoResolutionReason,
        },
      },
    });
  }

  private toRequest(row: any): AgentApprovalRequest {
    const request = this.record(row.requestJson);
    const error = this.record(row.errorJson);
    return {
      approvalId: row.approvalId,
      traceId: row.traceId,
      userId: row.userId,
      agentId: row.agentId,
      conversationId: row.conversationId,
      assistantMessageId: row.assistantMessageId,
      toolCallId: row.toolCallId ?? null,
      toolName: row.toolName,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      workflowId: row.workflowId ?? null,
      phaseId: row.phaseId ?? null,
      stepId: row.stepId ?? null,
      iteration: Number.isFinite(Number(row.iteration))
        ? Number(row.iteration)
        : null,
      taskRunId: row.scopeId,
      riskLevel: row.riskLevel,
      descriptorHash: row.descriptorHash,
      policyVersionAtRequest: Number(row.policyVersionAtRequest ?? 1),
      permissionMode: this.permissionMode(row.permissionMode),
      status: row.status,
      decision: row.decision ?? null,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      resumedAt: row.resumedAt?.toISOString() ?? null,
      resumeError: String(error.message ?? '').trim() || null,
      actionPreview: request.actionPreview ?? null,
    };
  }

  private optionalText(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }

  private permissionMode(value: unknown): AgentPermissionMode {
    if (value === 'audit_autorun' || value === 'full_access') return value;
    return 'confirm_required';
  }

  private record(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
  }
}
