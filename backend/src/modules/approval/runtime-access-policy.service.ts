import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RuntimeWorkspaceService } from '../workspace/runtime-workspace.service';
import type { AgentPermissionMode } from '../seekmore-agent/contracts/agent-turn.types';
import { RuntimeAccessPolicyEvents } from './runtime-access-policy.events';
import type {
  RuntimeApprovalScopeType,
  RuntimeConversationSettingsSnapshot,
  RuntimeEffectiveAccessPolicy,
  RuntimePreparedTurnAccessPolicy,
  RuntimeTaskAccessScope,
} from './runtime-access-policy.types';

const OPEN_WORKFLOW_STATUSES = ['RUNNING', 'WAITING', 'BLOCKED'];
const TERMINAL_TURN_STATUSES = [
  'succeeded',
  'partial',
  'failed',
  'blocked',
  'cancelled',
];

@Injectable()
export class RuntimeAccessPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: RuntimeWorkspaceService,
    private readonly events: RuntimeAccessPolicyEvents,
  ) {}

  async getConversationSettings(input: {
    userId: string;
    conversationId: string;
  }): Promise<RuntimeConversationSettingsSnapshot> {
    await this.assertConversation(input);
    const row = await this.ensureConversationSettings(input);
    return this.toConversationSnapshot(row);
  }

  async updateConversationSettings(input: {
    userId: string;
    conversationId: string;
    workspaceId?: string | null;
    permissionMode?: AgentPermissionMode;
  }): Promise<RuntimeConversationSettingsSnapshot> {
    const hasWorkspace = Object.prototype.hasOwnProperty.call(input, 'workspaceId');
    const hasPermission = Object.prototype.hasOwnProperty.call(input, 'permissionMode');
    if (!hasWorkspace && !hasPermission) {
      throw new BadRequestException('RUNTIME_SETTINGS_CHANGE_REQUIRED');
    }

    await this.assertConversation(input);
    const permissionMode = hasPermission
      ? this.requirePermissionMode(input.permissionMode)
      : undefined;
    const workspaceId = hasWorkspace
      ? this.normalizeWorkspaceId(input.workspaceId)
      : undefined;

    if (workspaceId) {
      await this.workspaces.get(input.userId, workspaceId);
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtext(${input.conversationId}))::text AS "lock"
      `);

      const delegate = (tx as any).conversationRuntimeSetting;
      const current = await delegate.findUnique({
        where: { conversationId: input.conversationId },
      });
      const currentMode = this.normalizePermissionMode(
        current?.permissionMode ?? 'confirm_required',
      );
      const currentWorkspaceId = this.normalizeWorkspaceId(current?.workspaceId);
      const nextMode = permissionMode ?? currentMode;
      const nextWorkspaceId = workspaceId === undefined
        ? currentWorkspaceId
        : workspaceId;
      const changedFields: Array<'workspaceId' | 'permissionMode'> = [];
      if (nextMode !== currentMode) changedFields.push('permissionMode');
      if (nextWorkspaceId !== currentWorkspaceId) changedFields.push('workspaceId');

      let row = current;
      if (!current) {
        row = await delegate.create({
          data: {
            conversationId: input.conversationId,
            userId: input.userId,
            workspaceId: nextWorkspaceId,
            permissionMode: nextMode,
          },
        });
        if (!changedFields.includes('permissionMode') && nextMode !== 'confirm_required') {
          changedFields.push('permissionMode');
        }
        if (!changedFields.includes('workspaceId') && nextWorkspaceId) {
          changedFields.push('workspaceId');
        }
      } else if (changedFields.length > 0) {
        row = await delegate.update({
          where: { conversationId: input.conversationId },
          data: {
            workspaceId: nextWorkspaceId,
            permissionMode: nextMode,
            version: { increment: 1 },
          },
        });
      }

      if (hasWorkspace || hasPermission) {
        const pendingRequests = await (tx as any).chatTurnRequest.findMany({
          where: {
            userId: input.userId,
            conversationId: input.conversationId,
            status: { in: ['QUEUED', 'STARTING'] },
          },
          select: { id: true, payload: true },
        });
        for (const request of pendingRequests) {
          const payload = this.record(request.payload);
          const runtimeOptions = this.record(payload.runtimeOptions);
          await (tx as any).chatTurnRequest.update({
            where: { id: request.id },
            data: {
              payload: {
                ...payload,
                runtimeOptions: {
                  ...runtimeOptions,
                  ...(hasWorkspace ? { workspaceId: nextWorkspaceId } : {}),
                  ...(hasPermission ? { permissionMode: nextMode } : {}),
                },
              } as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          });
        }

        const workflow = await (tx as any).workflowRun.findFirst({
          where: {
            userId: input.userId,
            conversationId: input.conversationId,
            status: { in: OPEN_WORKFLOW_STATUSES },
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (workflow) {
          await (tx as any).workflowRun.update({
            where: { id: workflow.id },
            data: {
              ...(hasWorkspace ? { workspaceId: nextWorkspaceId } : {}),
              ...(hasPermission ? { permissionMode: nextMode } : {}),
              version: { increment: 1 },
            },
          });
        } else if (hasPermission) {
          const turn = await (tx as any).agentTurn.findFirst({
            where: {
              userId: input.userId,
              conversationId: input.conversationId,
              completedAt: null,
              status: { notIn: TERMINAL_TURN_STATUSES },
            },
            orderBy: { startedAt: 'desc' },
          });
          if (turn) {
            await (tx as any).agentTurn.update({
              where: { id: turn.id },
              data: {
                permissionMode: nextMode,
                accessPolicyVersion: { increment: 1 },
              },
            });
          }
        }
      }

      return { row, changedFields };
    });

    const snapshot = await this.toConversationSnapshot(result.row);
    if (result.changedFields.length > 0) {
      this.events.publish({
        type: 'runtime.settings.updated',
        userId: input.userId,
        conversationId: input.conversationId,
        settings: snapshot,
        changedFields: result.changedFields,
        occurredAt: new Date().toISOString(),
      });
    }
    return snapshot;
  }

  async resolveForTurnPreparation(input: {
    traceId: string;
    userId: string;
    conversationId: string;
  }): Promise<RuntimePreparedTurnAccessPolicy> {
    const link = await (this.prisma as any).workflowTurnLink.findUnique({
      where: { traceId: input.traceId },
      include: { workflow: true },
    });
    const workflow = link?.workflow;
    if (workflow && OPEN_WORKFLOW_STATUSES.includes(String(workflow.status))) {
      if (workflow.userId !== input.userId
        || workflow.conversationId !== input.conversationId) {
        throw new ForbiddenException('WORKFLOW_ACCESS_SCOPE_MISMATCH');
      }
      return {
        userId: input.userId,
        conversationId: input.conversationId,
        workflowId: workflow.id,
        phaseId: link.phaseId ?? workflow.currentPhaseId ?? null,
        permissionMode: this.normalizePermissionMode(workflow.permissionMode),
        workspaceId: this.normalizeWorkspaceId(workflow.workspaceId),
        policyVersion: Math.max(1, Number(workflow.version ?? 1)),
      };
    }

    const settings = await this.ensureConversationSettings({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    return {
      userId: input.userId,
      conversationId: input.conversationId,
      workflowId: null,
      phaseId: null,
      permissionMode: this.normalizePermissionMode(settings.permissionMode),
      workspaceId: this.normalizeWorkspaceId(settings.workspaceId),
      policyVersion: Math.max(1, Number(settings.version ?? 1)),
    };
  }

  async resolveForInvocation(input: {
    traceId: string;
    userId: string;
    conversationId: string;
    requestedPermissionMode?: AgentPermissionMode | null;
    requestedWorkspaceId?: string | null;
  }): Promise<RuntimeEffectiveAccessPolicy> {
    const turn = await (this.prisma as any).agentTurn.findUnique({
      where: { traceId: input.traceId },
    });
    if (!turn) throw new NotFoundException('AGENT_TURN_NOT_FOUND');
    if (turn.userId !== input.userId || turn.conversationId !== input.conversationId) {
      throw new ForbiddenException('AGENT_TURN_SCOPE_MISMATCH');
    }

    const link = await (this.prisma as any).workflowTurnLink.findUnique({
      where: { traceId: input.traceId },
      include: { workflow: true },
    });
    const workflow = link?.workflow;
    if (workflow && OPEN_WORKFLOW_STATUSES.includes(String(workflow.status))) {
      return {
        userId: input.userId,
        conversationId: input.conversationId,
        scopeType: 'WORKFLOW',
        scopeId: workflow.id,
        workflowId: workflow.id,
        phaseId: link.phaseId ?? workflow.currentPhaseId ?? null,
        permissionMode: this.normalizePermissionMode(workflow.permissionMode),
        workspaceId:
          this.normalizeWorkspaceId(
            turn.workspaceId,
          ),
        policyVersion: Math.max(
          Math.max(1, Number(turn.accessPolicyVersion ?? 1)),
          Math.max(1, Number(workflow.version ?? 1)),
        ),
      };
    }

    const settings = await this.ensureConversationSettings({
      userId: input.userId,
      conversationId: input.conversationId,
    });
    const turnVersion = Math.max(1, Number(turn.accessPolicyVersion ?? 1));
    const settingsVersion = Math.max(1, Number(settings.version ?? 1));
    const conversationIsNewer = settingsVersion > turnVersion;
    return {
      userId: input.userId,
      conversationId: input.conversationId,
      scopeType: 'TURN',
      scopeId: turn.id,
      workflowId: null,
      phaseId: null,
      permissionMode: this.normalizePermissionMode(
        conversationIsNewer
          ? settings.permissionMode
          : turn.permissionMode
            ?? input.requestedPermissionMode
            ?? settings.permissionMode,
      ),
      workspaceId:
        this.normalizeWorkspaceId(
          turn.workspaceId,
        ),
      policyVersion: Math.max(turnVersion, settingsVersion),
    };
  }

  async setTaskPermission(input: {
    userId: string;
    scopeType: RuntimeApprovalScopeType;
    scopeId: string;
    permissionMode: AgentPermissionMode;
  }): Promise<RuntimeEffectiveAccessPolicy | null> {
    const permissionMode = this.normalizePermissionMode(input.permissionMode);
    if (input.scopeType === 'WORKFLOW') {
      const changed = await (this.prisma as any).workflowRun.updateMany({
        where: {
          id: input.scopeId,
          userId: input.userId,
          status: { in: OPEN_WORKFLOW_STATUSES },
        },
        data: {
          permissionMode,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) return null;
      return this.getTaskPolicy('WORKFLOW', input.scopeId, input.userId);
    }

    const changed = await (this.prisma as any).agentTurn.updateMany({
      where: {
        id: input.scopeId,
        userId: input.userId,
        completedAt: null,
        status: { notIn: TERMINAL_TURN_STATUSES },
      },
      data: {
        permissionMode,
        accessPolicyVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) return null;
    return this.getTaskPolicy('TURN', input.scopeId, input.userId);
  }

  async getTaskPolicy(
    scopeType: RuntimeApprovalScopeType,
    scopeId: string,
    userId: string,
  ): Promise<RuntimeEffectiveAccessPolicy | null> {
    if (scopeType === 'WORKFLOW') {
      const row = await (this.prisma as any).workflowRun.findFirst({
        where: {
          id: scopeId,
          userId,
          status: { in: OPEN_WORKFLOW_STATUSES },
        },
      });
      if (!row) return null;
      return {
        userId,
        conversationId: row.conversationId,
        scopeType,
        scopeId,
        workflowId: row.id,
        phaseId: row.currentPhaseId ?? null,
        permissionMode: this.normalizePermissionMode(row.permissionMode),
        workspaceId: this.normalizeWorkspaceId(row.workspaceId),
        policyVersion: Math.max(1, Number(row.version ?? 1)),
      };
    }

    const row = await (this.prisma as any).agentTurn.findFirst({
      where: {
        id: scopeId,
        userId,
        completedAt: null,
        status: { notIn: TERMINAL_TURN_STATUSES },
      },
    });
    if (!row) return null;
    return {
      userId,
      conversationId: row.conversationId,
      scopeType,
      scopeId,
      workflowId: null,
      phaseId: null,
      permissionMode: this.normalizePermissionMode(row.permissionMode),
      workspaceId: this.normalizeWorkspaceId(row.workspaceId),
      policyVersion: Math.max(1, Number(row.accessPolicyVersion ?? 1)),
    };
  }

  taskScopeFromPolicy(policy: RuntimeEffectiveAccessPolicy): RuntimeTaskAccessScope {
    return {
      scopeType: policy.scopeType,
      scopeId: policy.scopeId,
      workflowId: policy.workflowId,
      phaseId: policy.phaseId,
    };
  }

  private async ensureConversationSettings(input: {
    userId: string;
    conversationId: string;
  }): Promise<any> {
    const delegate = (this.prisma as any).conversationRuntimeSetting;
    const existing = await delegate.findUnique({
      where: { conversationId: input.conversationId },
    });
    if (existing) return existing;
    try {
      return await delegate.create({
        data: {
          conversationId: input.conversationId,
          userId: input.userId,
          workspaceId: null,
          permissionMode: 'confirm_required',
        },
      });
    } catch {
      return delegate.findUnique({
        where: { conversationId: input.conversationId },
      });
    }
  }

  private async assertConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        userId: input.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException('CONVERSATION_NOT_FOUND');
  }

  private async toConversationSnapshot(row: any): Promise<RuntimeConversationSettingsSnapshot> {
    const workspaceId = this.normalizeWorkspaceId(row?.workspaceId);
    let workspace: RuntimeConversationSettingsSnapshot['workspace'] = null;
    if (workspaceId) {
      try {
        workspace = await this.workspaces.get(row.userId, workspaceId);
      } catch {
        workspace = null;
      }
    }
    return {
      conversationId: String(row.conversationId),
      userId: String(row.userId),
      workspaceId,
      workspace,
      permissionMode: this.normalizePermissionMode(row.permissionMode),
      version: Math.max(1, Number(row.version ?? 1)),
      updatedAt: row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : new Date(row.updatedAt ?? Date.now()).toISOString(),
    };
  }

  private record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private requirePermissionMode(value: unknown): AgentPermissionMode {
    if (
      value === 'confirm_required'
      || value === 'audit_autorun'
      || value === 'full_access'
    ) {
      return value;
    }
    throw new BadRequestException('INVALID_RUNTIME_PERMISSION_MODE');
  }

  private normalizePermissionMode(value: unknown): AgentPermissionMode {
    if (value === 'audit_autorun' || value === 'full_access') return value;
    return 'confirm_required';
  }

  private normalizeWorkspaceId(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
  }
}
