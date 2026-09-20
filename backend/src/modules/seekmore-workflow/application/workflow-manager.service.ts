import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AgentPermissionMode } from '../../seekmore-agent/contracts/agent-turn.types';
import type {
  WorkflowBlockInput,
  WorkflowCompleteInput,
  WorkflowControlInput,
  WorkflowStartInput,
  WorkflowUpdateInput,
} from '../contracts/workflow-lifecycle.types';
import type {
  WorkflowPhaseCreateInput,
  WorkflowPhaseDraft,
  WorkflowPhaseSnapshot,
} from '../contracts/workflow-phase.types';
import type {
  WorkflowContinuationMode,
  WorkflowRunSnapshot,
} from '../contracts/workflow-run.types';
import { WorkflowPhasePolicy } from '../domain/workflow-phase.policy';
import { WorkflowEventPublisher } from '../events/workflow-event.publisher';
import { WorkflowEventRepository } from '../persistence/workflow-event.repository';
import { WorkflowPhaseRepository } from '../persistence/workflow-phase.repository';
import { WorkflowRunRepository, type WorkflowConversationScope } from '../persistence/workflow-run.repository';
import { WorkflowTransactionService } from '../persistence/workflow-transaction.service';
import { WorkflowTurnLinkRepository, type WorkflowTurnTrigger } from '../persistence/workflow-turn-link.repository';

export interface WorkflowManagerSnapshot {
  run: WorkflowRunSnapshot;
  phases: WorkflowPhaseSnapshot[];
  currentPhase: WorkflowPhaseSnapshot | null;
}

@Injectable()
export class WorkflowManagerService {
  constructor(
    private readonly runs: WorkflowRunRepository,
    private readonly phases: WorkflowPhaseRepository,
    private readonly turnLinks: WorkflowTurnLinkRepository,
    private readonly events: WorkflowEventRepository,
    private readonly transactions: WorkflowTransactionService,
    private readonly phasePolicy: WorkflowPhasePolicy,
    private readonly publisher: WorkflowEventPublisher,
  ) {}

  async start(input: WorkflowStartInput & {
    scope: WorkflowConversationScope;
    branchId: string | null;
    workspaceId: string | null;
    initialUserMessageId: string;
    inputObjectIds: string[];
    permissionMode: AgentPermissionMode;
    traceId: string;
    assistantMessageId: string | null;
  }): Promise<WorkflowManagerSnapshot & { created: boolean }> {
    const title = this.requiredText(input.title, 'WORKFLOW_TITLE_REQUIRED', 256);
    const goal = this.requiredText(input.goal, 'WORKFLOW_GOAL_REQUIRED', 20_000);
    const drafts = this.normalizeDrafts(input.phases);

    const result = await this.transactions.withConversationLock(input.scope.conversationId, async (tx) => {
      const existing = await this.runs.findActiveByConversation(input.scope, tx);
      if (existing) {
        const policyChanged =
          existing.workspaceId !== input.workspaceId
          || existing.permissionMode !== input.permissionMode;
        const current = policyChanged
          ? await this.runs.update(tx, {
              workflowId: existing.id,
              expectedVersion: existing.version,
              workspaceId: input.workspaceId,
              permissionMode: input.permissionMode,
            })
          : existing;
        const existingPhases = await this.phases.listByWorkflow(current.id, tx);
        await this.turnLinks.bind(tx, {
          workflowId: current.id,
          phaseId: current.currentPhaseId,
          traceId: input.traceId,
          userMessageId: input.initialUserMessageId,
          assistantMessageId: input.assistantMessageId,
          trigger: 'USER',
        });
        return {
          created: false,
          run: current,
          phases: existingPhases,
          currentPhase: existingPhases.find((phase) => phase.id === current.currentPhaseId) ?? null,
        };
      }

      const workflowId = `workflow_${randomUUID()}`;
      const prepared = this.prepareDrafts(workflowId, drafts);
      this.phasePolicy.validateGraph(prepared);

      const first = this.phasePolicy.firstExecutable(prepared);
      if (!first) throw new Error('WORKFLOW_PHASE_EXECUTABLE_REQUIRED');
      const firstIndex = prepared.findIndex((phase) => phase.id === first.id);
      prepared[firstIndex] = {
        ...prepared[firstIndex],
        status: 'ACTIVE',
      };

      let run = await this.runs.create(tx, {
        id: workflowId,
        userId: input.scope.userId,
        agentId: input.scope.agentId,
        conversationId: input.scope.conversationId,
        branchId: input.branchId,
        workspaceId: input.workspaceId,
        initialUserMessageId: input.initialUserMessageId,
        inputObjectIds: input.inputObjectIds,
        title,
        goal,
        contract: {
          constraints: this.textArray(input.constraints),
          expectedDeliverables: this.textArray(input.expectedDeliverables),
          metadata: this.record(input.metadata),
        },
        continuationMode: input.continuationMode,
        permissionMode: input.permissionMode,
      });
      await this.phases.createMany(tx, prepared);
      const currentPhaseId = prepared[firstIndex]?.id ?? null;
      run = await this.runs.update(tx, {
        workflowId: run.id,
        expectedVersion: run.version,
        currentPhaseId,
      });
      await this.turnLinks.bind(tx, {
        workflowId: run.id,
        phaseId: currentPhaseId,
        traceId: input.traceId,
        userMessageId: input.initialUserMessageId,
        assistantMessageId: input.assistantMessageId,
        trigger: 'USER',
      });
      await this.events.append(tx, {
        workflowId: run.id,
        phaseId: currentPhaseId,
        type: 'workflow.created',
        payload: {
          title: run.title,
          goal: run.goal,
          phaseCount: prepared.length,
          currentPhaseId,
          sourceTraceId: input.traceId,
        },
        deduplicationKey: `${input.traceId}:workflow_created`,
      });
      const snapshots = await this.phases.listByWorkflow(run.id, tx);
      return {
        created: true,
        run,
        phases: snapshots,
        currentPhase: snapshots.find((phase) => phase.id === currentPhaseId) ?? null,
      };
    });

    this.publisher.publishSnapshot({
      run: result.run,
      phases: result.phases,
      reason: result.created ? 'created' : 'state_changed',
      traceId: input.traceId,
    });
    return result;
  }

  async update(input: WorkflowUpdateInput & {
    run: WorkflowRunSnapshot;
    traceId: string;
  }): Promise<WorkflowManagerSnapshot> {
    const result = await this.transactions.withConversationLock(input.run.conversationId, async (tx) => {
      let run = await this.requireCurrent(input.run.id, tx);
      this.assertOpen(run);
      const progressSummary = this.optionalText(input.progressSummary, 20_000);
      const hasRunMutation = input.goal !== undefined
        || input.constraints !== undefined
        || input.expectedDeliverables !== undefined;
      const hasBoardMutation = Boolean(
        input.currentPhaseId !== undefined
        || input.add?.length
        || input.update?.length
        || input.skipPhaseIds?.length
        || input.cancelPhaseIds?.length
        || input.removePhaseIds?.length
        || input.completedPhases?.length
      );
      if (!progressSummary && !hasRunMutation && !hasBoardMutation) {
        throw new Error('WORKFLOW_UPDATE_EMPTY');
      }

      const existing = await this.phases.listByWorkflow(run.id, tx);
      const existingIds = new Set(existing.map((phase) => phase.id));
      const additions = this.prepareAddedDrafts(
        run.id,
        input.add ?? [],
        existingIds,
        existing.reduce((max, phase) => Math.max(max, phase.position), -1) + 1,
      );
      const allForValidation = [
        ...existing
          .filter((phase) => !(input.removePhaseIds ?? []).includes(phase.id))
          .map((phase) => this.toCreateInput(phase)),
        ...additions,
      ];
      const patches = input.update ?? [];
      const patchById = new Map(patches.map((patch) => [patch.phaseId, patch]));
      const validated = allForValidation.map((phase) => {
        const patch = patchById.get(phase.id);
        return patch ? {
          ...phase,
          title: patch.title ?? phase.title,
          description: patch.description === undefined ? phase.description : patch.description,
          parentPhaseId: patch.parentPhaseId === undefined ? phase.parentPhaseId : patch.parentPhaseId,
          dependencyIds: patch.dependencyIds ?? phase.dependencyIds,
          position: patch.position ?? phase.position,
          acceptanceCriteria: patch.acceptanceCriteria === undefined
            ? phase.acceptanceCriteria
            : patch.acceptanceCriteria,
        } : phase;
      });
      this.phasePolicy.validateGraph(validated);

      for (const patch of patches) {
        if (!existingIds.has(patch.phaseId)) throw new Error(`WORKFLOW_PHASE_NOT_FOUND:${patch.phaseId}`);
        await this.phases.update(tx, patch);
      }
      for (const phase of additions) await this.phases.create(tx, phase);

      for (const phaseId of input.skipPhaseIds ?? []) {
        await this.requirePhase(run.id, phaseId, tx);
        await this.phases.setStatus(tx, {
          phaseId,
          status: 'SKIPPED',
          resultSummary: 'Skipped by workflow.update.',
        });
      }
      for (const phaseId of input.cancelPhaseIds ?? []) {
        await this.requirePhase(run.id, phaseId, tx);
        await this.phases.setStatus(tx, {
          phaseId,
          status: 'CANCELLED',
          resultSummary: 'Cancelled by workflow.update.',
        });
      }
      if (input.removePhaseIds?.length) {
        for (const phaseId of input.removePhaseIds) {
          const phase = await this.requirePhase(run.id, phaseId, tx);
          if (phase.status !== 'PENDING') throw new Error(`WORKFLOW_PHASE_REMOVE_REQUIRES_PENDING:${phaseId}`);
        }
        await this.phases.deleteMany(tx, run.id, input.removePhaseIds);
      }

      let latest = await this.phases.listByWorkflow(run.id, tx);
      const completionIds = new Set((input.completedPhases ?? []).map((item) => item.phaseId));
      for (const completion of input.completedPhases ?? []) {
        const phase = latest.find((item) => item.id === completion.phaseId);
        if (!phase) throw new Error(`WORKFLOW_PHASE_NOT_FOUND:${completion.phaseId}`);
        if (this.phasePolicy.isContainer(phase.id, latest)) {
          throw new Error(`WORKFLOW_PHASE_CONTAINER_NOT_EXECUTABLE:${phase.id}`);
        }
        if (phase.status === 'COMPLETED') continue;
        if (this.phasePolicy.isTerminal(phase.status)) {
          throw new Error(`WORKFLOW_PHASE_ALREADY_TERMINAL:${phase.id}`);
        }
        for (const dependencyId of phase.dependencyIds) {
          const dependency = latest.find((item) => item.id === dependencyId);
          const satisfied = dependency?.status === 'COMPLETED'
            || dependency?.status === 'SKIPPED'
            || completionIds.has(dependencyId);
          if (!satisfied) {
            throw new Error(`WORKFLOW_PHASE_DEPENDENCY_UNSATISFIED:${phase.id}:${dependencyId}`);
          }
        }
      }

      for (const completion of input.completedPhases ?? []) {
        const phase = await this.requirePhase(run.id, completion.phaseId, tx);
        if (phase.status === 'COMPLETED') continue;
        const summary = this.requiredText(
          completion.summary,
          'WORKFLOW_PHASE_SUMMARY_REQUIRED',
          20_000,
        );
        await this.phases.setStatus(tx, {
          phaseId: phase.id,
          status: 'COMPLETED',
          resultSummary: summary,
          result: completion.result ?? null,
        });
        await this.completeReadyParents(tx, run.id, phase.parentPhaseId);
        await this.events.append(tx, {
          workflowId: run.id,
          phaseId: phase.id,
          type: 'phase.completed',
          payload: {
            summary,
            sourceTraceId: input.traceId,
            protocolAction: 'UPDATE',
            completedByCheckpoint: true,
          },
          deduplicationKey: `${input.traceId}:phase_checkpoint_completed:${phase.id}`,
        });
      }

      let currentPhaseId = input.currentPhaseId === undefined
        ? run.currentPhaseId
        : input.currentPhaseId;
      latest = await this.phases.listByWorkflow(run.id, tx);
      if (currentPhaseId) {
        const target = latest.find((phase) => phase.id === currentPhaseId);
        if (!target || this.phasePolicy.isTerminal(target.status)) {
          currentPhaseId = null;
        } else if (this.phasePolicy.isContainer(target.id, latest)) {
          throw new Error(`WORKFLOW_PHASE_CONTAINER_NOT_EXECUTABLE:${target.id}`);
        } else {
          this.assertDependenciesSatisfied(target, latest);
          for (const phase of latest.filter((phase) => phase.status === 'ACTIVE' && phase.id !== target.id)) {
            await this.phases.setStatus(tx, { phaseId: phase.id, status: 'PENDING' });
          }
          if (target.status !== 'ACTIVE') {
            await this.phases.setStatus(tx, { phaseId: target.id, status: 'ACTIVE' });
          }
        }
      }
      if (!currentPhaseId) {
        const next = this.phasePolicy.nextExecutable(await this.phases.listByWorkflow(run.id, tx));
        if (next) {
          for (const phase of (await this.phases.listByWorkflow(run.id, tx)).filter((item) => item.status === 'ACTIVE' && item.id !== next.id)) {
            await this.phases.setStatus(tx, { phaseId: phase.id, status: 'PENDING' });
          }
          await this.phases.setStatus(tx, { phaseId: next.id, status: 'ACTIVE' });
          currentPhaseId = next.id;
        }
      }

      latest = await this.phases.listByWorkflow(run.id, tx);
      const completed = this.phasePolicy.allDone(latest);
      const blocked = !completed
        && !currentPhaseId
        && latest.some((phase) => phase.status === 'BLOCKED');
      const waiting = !completed && !currentPhaseId && !blocked;
      const contract = input.constraints !== undefined || input.expectedDeliverables !== undefined
        ? {
            ...run.contract,
            constraints: input.constraints === undefined
              ? run.contract.constraints
              : this.textArray(input.constraints),
            expectedDeliverables: input.expectedDeliverables === undefined
              ? run.contract.expectedDeliverables
              : this.textArray(input.expectedDeliverables),
          }
        : undefined;

      run = await this.runs.update(tx, {
        workflowId: run.id,
        expectedVersion: run.version,
        goal: input.goal === undefined
          ? undefined
          : this.requiredText(input.goal, 'WORKFLOW_GOAL_REQUIRED', 20_000),
        contract,
        status: completed
          ? 'COMPLETED'
          : blocked
            ? 'BLOCKED'
            : waiting
              ? 'WAITING'
              : 'RUNNING',
        waitReason: waiting ? 'RESOURCE_CONFLICT' : blocked ? 'RESOURCE_CONFLICT' : null,
        currentPhaseId: completed ? null : currentPhaseId,
        completedAt: completed ? new Date() : undefined,
      });

      const linked = await this.turnLinks.findByTrace(input.traceId, tx);
      if (linked && linked.workflowId === run.id && linked.phaseId !== run.currentPhaseId) {
        await this.turnLinks.bind(tx, {
          workflowId: run.id,
          phaseId: run.currentPhaseId,
          traceId: linked.traceId,
          userMessageId: linked.userMessageId,
          assistantMessageId: linked.assistantMessageId,
          trigger: linked.trigger,
        });
      }

      await this.events.append(tx, {
        workflowId: run.id,
        phaseId: run.currentPhaseId,
        type: completed ? 'workflow.completed' : 'workflow.updated',
        payload: {
          sourceTraceId: input.traceId,
          protocolAction: 'UPDATE',
          progressSummary,
          goalChanged: input.goal !== undefined,
          contractChanged: contract !== undefined,
          completedPhaseIds: [...completionIds],
        },
        deduplicationKey: `${input.traceId}:workflow_updated:${run.version}`,
      });
      return {
        run,
        phases: latest,
        currentPhase: latest.find((phase) => phase.id === run.currentPhaseId) ?? null,
      };
    });
    this.publisher.publishSnapshot({
      run: result.run,
      phases: result.phases,
      reason: result.run.status === 'COMPLETED' ? 'completed' : 'phase_changed',
      traceId: input.traceId,
    });
    return result;
  }

  async complete(input: WorkflowCompleteInput & {
    run: WorkflowRunSnapshot;
    phaseId: string;
    traceId: string;
  }): Promise<WorkflowManagerSnapshot> {
    const result = await this.transactions.withConversationLock(input.run.conversationId, async (tx) => {
      let run = await this.requireCurrent(input.run.id, tx);
      this.assertOpen(run);
      if (!run.currentPhaseId || run.currentPhaseId !== input.phaseId) {
        throw new Error(`WORKFLOW_TURN_STALE:${input.phaseId}:${run.currentPhaseId ?? 'none'}`);
      }
      const phase = await this.requirePhase(run.id, input.phaseId, tx);
      if (this.phasePolicy.isTerminal(phase.status)) throw new Error('WORKFLOW_PHASE_ALREADY_TERMINAL');
      await this.phases.setStatus(tx, {
        phaseId: phase.id,
        status: 'COMPLETED',
        resultSummary: this.requiredText(input.summary, 'WORKFLOW_PHASE_SUMMARY_REQUIRED', 20_000),
        result: input.result ?? null,
      });
      await this.completeReadyParents(tx, run.id, phase.parentPhaseId);
      let latest = await this.phases.listByWorkflow(run.id, tx);
      const next = this.phasePolicy.nextExecutable(latest);
      if (next) await this.phases.setStatus(tx, { phaseId: next.id, status: 'ACTIVE' });
      latest = await this.phases.listByWorkflow(run.id, tx);
      const completed = this.phasePolicy.allDone(latest);
      const blockedByDependencies = !completed && !next && latest.some((item) => item.status === 'PENDING');
      run = await this.runs.update(tx, {
        workflowId: run.id,
        expectedVersion: run.version,
        status: completed ? 'COMPLETED' : blockedByDependencies ? 'WAITING' : 'RUNNING',
        waitReason: blockedByDependencies ? 'RESOURCE_CONFLICT' : null,
        currentPhaseId: completed ? null : next?.id ?? null,
        completedAt: completed ? new Date() : undefined,
      });
      await this.events.append(tx, {
        workflowId: run.id,
        phaseId: phase.id,
        type: 'phase.completed',
        payload: {
          summary: input.summary,
          nextPhaseId: run.currentPhaseId,
          sourceTraceId: input.traceId,
          protocolAction: 'COMPLETE',
        },
        deduplicationKey: `${input.traceId}:phase_completed:${phase.id}`,
      });
      if (completed) {
        await this.events.append(tx, {
          workflowId: run.id,
          type: 'workflow.completed',
          payload: {
            sourceTraceId: input.traceId,
            protocolAction: 'COMPLETE',
          },
          deduplicationKey: `${input.traceId}:workflow_completed`,
        });
      }
      return {
        run,
        phases: latest,
        currentPhase: latest.find((item) => item.id === run.currentPhaseId) ?? null,
      };
    });
    this.publisher.publishSnapshot({
      run: result.run,
      phases: result.phases,
      reason: result.run.status === 'COMPLETED' ? 'completed' : 'phase_changed',
      traceId: input.traceId,
    });
    return result;
  }

  async block(input: WorkflowBlockInput & {
    run: WorkflowRunSnapshot;
    phaseId: string;
    traceId: string;
  }): Promise<WorkflowManagerSnapshot> {
    const result = await this.transactions.withConversationLock(input.run.conversationId, async (tx) => {
      let run = await this.requireCurrent(input.run.id, tx);
      this.assertOpen(run);
      if (!run.currentPhaseId || run.currentPhaseId !== input.phaseId) {
        throw new Error(`WORKFLOW_TURN_STALE:${input.phaseId}:${run.currentPhaseId ?? 'none'}`);
      }
      const phaseId = input.phaseId;
      await this.requirePhase(run.id, phaseId, tx);
      const unrecoverable = input.kind === 'UNRECOVERABLE';
      await this.phases.setStatus(tx, {
        phaseId,
        status: unrecoverable ? 'FAILED' : 'BLOCKED',
        resultSummary: this.requiredText(input.reason, 'WORKFLOW_BLOCK_REASON_REQUIRED', 20_000),
      });
      const status = unrecoverable ? 'FAILED' : input.kind === 'USER_INPUT' ? 'WAITING' : 'BLOCKED';
      const waitReason = input.kind === 'USER_INPUT'
        ? 'USER_INPUT'
        : input.kind === 'EXTERNAL_DEPENDENCY'
          ? 'EXTERNAL_DEPENDENCY'
          : input.kind === 'RESOURCE_CONFLICT'
            ? 'RESOURCE_CONFLICT'
            : null;
      run = await this.runs.update(tx, {
        workflowId: run.id,
        expectedVersion: run.version,
        status,
        waitReason,
        failedAt: unrecoverable ? new Date() : undefined,
      });
      await this.events.append(tx, {
        workflowId: run.id,
        phaseId,
        type: unrecoverable ? 'phase.failed' : 'phase.blocked',
        payload: {
          kind: input.kind,
          reason: input.reason,
          sourceTraceId: input.traceId,
          protocolAction: 'BLOCK',
        },
        deduplicationKey: `${input.traceId}:phase_blocked:${phaseId}`,
      });
      const latest = await this.phases.listByWorkflow(run.id, tx);
      return {
        run,
        phases: latest,
        currentPhase: latest.find((phase) => phase.id === run.currentPhaseId) ?? null,
      };
    });
    this.publisher.publishSnapshot({
      run: result.run,
      phases: result.phases,
      reason: 'state_changed',
      traceId: input.traceId,
    });
    return result;
  }

  async control(input: WorkflowControlInput & { run: WorkflowRunSnapshot; traceId: string }): Promise<WorkflowManagerSnapshot> {
    const result = await this.transactions.withConversationLock(input.run.conversationId, async (tx) => {
      let run = await this.requireCurrent(input.run.id, tx);
      if (input.action === 'CANCEL') {
        const latest = await this.phases.listByWorkflow(run.id, tx);
        for (const phase of latest.filter((item) => !this.phasePolicy.isTerminal(item.status))) {
          await this.phases.setStatus(tx, { phaseId: phase.id, status: 'CANCELLED', resultSummary: input.reason ?? 'Workflow cancelled.' });
        }
        run = await this.runs.update(tx, {
          workflowId: run.id,
          expectedVersion: run.version,
          status: 'CANCELLED',
          waitReason: null,
          currentPhaseId: null,
          cancelledAt: new Date(),
        });
      } else if (input.action === 'PAUSE') {
        this.assertOpen(run);
        run = await this.runs.update(tx, {
          workflowId: run.id,
          expectedVersion: run.version,
          status: 'WAITING',
          waitReason: 'CONTINUATION',
        });
      } else if (input.action === 'SET_CONTINUATION') {
        this.assertOpen(run);
        if (!input.continuationMode) throw new Error('WORKFLOW_CONTINUATION_MODE_REQUIRED');
        run = await this.runs.update(tx, {
          workflowId: run.id,
          expectedVersion: run.version,
          continuationMode: input.continuationMode,
        });
      } else {
        this.assertOpen(run);
        let latest = await this.phases.listByWorkflow(run.id, tx);
        let current = latest.find((phase) => phase.id === run.currentPhaseId) ?? null;
        if (current && current.status === 'BLOCKED') {
          current = await this.phases.setStatus(tx, { phaseId: current.id, status: 'ACTIVE' });
        }
        if (!current || this.phasePolicy.isTerminal(current.status)) {
          const next = this.phasePolicy.nextExecutable(latest);
          if (next) current = await this.phases.setStatus(tx, { phaseId: next.id, status: 'ACTIVE' });
        }
        latest = await this.phases.listByWorkflow(run.id, tx);
        const completed = this.phasePolicy.allDone(latest);
        const blocked = !completed
          && !current
          && latest.some((phase) => phase.status === 'BLOCKED');
        run = await this.runs.update(tx, {
          workflowId: run.id,
          expectedVersion: run.version,
          status: completed
            ? 'COMPLETED'
            : current
              ? 'RUNNING'
              : blocked
                ? 'BLOCKED'
                : 'WAITING',
          waitReason: completed || current ? null : 'RESOURCE_CONFLICT',
          currentPhaseId: completed ? null : current?.id ?? null,
          completedAt: completed ? new Date() : undefined,
        });
      }
      await this.events.append(tx, {
        workflowId: run.id,
        phaseId: run.currentPhaseId,
        type: `workflow.${input.action.toLowerCase()}`,
        payload: {
          reason: input.reason ?? null,
          continuationMode: input.continuationMode ?? null,
          sourceTraceId: input.traceId,
          protocolAction: 'CONTROL',
          controlAction: input.action,
        },
        deduplicationKey: `${input.traceId}:workflow_control:${input.action}:${run.version}`,
      });
      const latest = await this.phases.listByWorkflow(run.id, tx);
      return { run, phases: latest, currentPhase: latest.find((phase) => phase.id === run.currentPhaseId) ?? null };
    });
    this.publisher.publishSnapshot({
      run: result.run,
      phases: result.phases,
      reason: result.run.status === 'CANCELLED'
        ? 'cancelled'
        : input.action === 'SET_CONTINUATION'
          ? 'continuation_changed'
          : 'state_changed',
      traceId: input.traceId,
    });
    return result;
  }

  async bindTurn(input: {
    run: WorkflowRunSnapshot;
    traceId: string;
    userMessageId: string;
    assistantMessageId: string;
    trigger: WorkflowTurnTrigger;
  }): Promise<void> {
    await this.transactions.withTransaction((tx) => this.turnLinks.bind(tx, {
      workflowId: input.run.id,
      phaseId: input.run.currentPhaseId,
      traceId: input.traceId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      trigger: input.trigger,
    }).then(() => undefined));
  }

  async setWaitingAfterTurn(input: {
    run: WorkflowRunSnapshot;
    traceId: string;
    reason?: string;
  }): Promise<WorkflowManagerSnapshot> {
    return this.control({
      action: 'PAUSE',
      reason: input.reason ?? 'manual_continuation',
      run: input.run,
      traceId: input.traceId,
    });
  }

  async requestAutoContinuation(input: {
    run: WorkflowRunSnapshot;
    traceId: string;
    protocolAction: 'UPDATE' | 'COMPLETE';
  }): Promise<void> {
    await this.requestContinuation({
      ...input,
      reason: 'auto_continue',
    });
  }

  async requestUserResume(input: {
    run: WorkflowRunSnapshot;
    traceId: string;
  }): Promise<void> {
    await this.requestContinuation({
      ...input,
      reason: 'user_resume',
      protocolAction: 'CONTROL',
    });
  }

  private async requestContinuation(input: {
    run: WorkflowRunSnapshot;
    traceId: string;
    reason: 'auto_continue' | 'user_resume';
    protocolAction: 'UPDATE' | 'COMPLETE' | 'CONTROL';
  }): Promise<void> {
    await this.transactions.withConversationLock(input.run.conversationId, async (tx) => {
      const current = await this.requireCurrent(input.run.id, tx);
      if (current.status !== 'RUNNING' || !current.currentPhaseId) return;
      if (input.reason === 'auto_continue' && current.continuationMode !== 'AUTO') return;

      await this.events.append(tx, {
        workflowId: current.id,
        phaseId: current.currentPhaseId,
        type: 'workflow.turn.requested',
        payload: {
          sourceTraceId: input.traceId,
          reason: input.reason,
          protocolAction: input.protocolAction,
          expectedWorkflowVersion: current.version,
        },
        deduplicationKey: `${input.traceId}:workflow_turn_requested:${input.reason}`,
      });
    });
  }

  async markPausedByAgent(input: {
    run: WorkflowRunSnapshot;
    traceId: string;
    reason: 'approval' | 'user_input' | 'external_dependency';
  }): Promise<WorkflowManagerSnapshot> {
    const waitReason = input.reason === 'approval'
      ? 'APPROVAL'
      : input.reason === 'external_dependency'
        ? 'EXTERNAL_DEPENDENCY'
        : 'USER_INPUT';
    const result = await this.transactions.withConversationLock(input.run.conversationId, async (tx) => {
      const current = await this.requireCurrent(input.run.id, tx);
      const run = await this.runs.update(tx, {
        workflowId: current.id,
        expectedVersion: current.version,
        status: 'WAITING',
        waitReason,
      });
      const phases = await this.phases.listByWorkflow(run.id, tx);
      return { run, phases, currentPhase: phases.find((phase) => phase.id === run.currentPhaseId) ?? null };
    });
    this.publisher.publishSnapshot({ run: result.run, phases: result.phases, reason: 'state_changed', traceId: input.traceId });
    return result;
  }

  private normalizeDrafts(value: WorkflowPhaseDraft[]): WorkflowPhaseDraft[] {
    if (!Array.isArray(value) || !value.length) throw new Error('WORKFLOW_PHASES_REQUIRED');
    if (value.length > 1000) throw new Error('WORKFLOW_PAYLOAD_TOO_LARGE');
    const refs = new Set<string>();
    return value.map((phase, index) => {
      const ref = this.requiredText(phase.ref, 'WORKFLOW_PHASE_REF_REQUIRED', 180);
      if (refs.has(ref)) throw new Error(`WORKFLOW_PHASE_REF_DUPLICATED:${ref}`);
      refs.add(ref);
      return {
        ref,
        title: this.requiredText(phase.title, 'WORKFLOW_PHASE_TITLE_REQUIRED', 256),
        description: this.optionalText(phase.description, 20_000),
        parentRef: this.optionalText(phase.parentRef, 180),
        dependencyRefs: this.textArray(phase.dependencyRefs),
        acceptanceCriteria: phase.acceptanceCriteria ?? null,
      };
    });
  }

  private prepareDrafts(workflowId: string, drafts: WorkflowPhaseDraft[]): WorkflowPhaseCreateInput[] {
    const ids = new Map(drafts.map((phase) => [phase.ref, `phase_${randomUUID()}`]));
    return drafts.map((phase, position) => ({
      id: ids.get(phase.ref)!,
      workflowId,
      parentPhaseId: phase.parentRef ? ids.get(phase.parentRef) ?? null : null,
      title: phase.title,
      description: phase.description ?? null,
      status: 'PENDING',
      position,
      dependencyIds: (phase.dependencyRefs ?? []).map((ref) => ids.get(ref) ?? `missing:${ref}`),
      acceptanceCriteria: phase.acceptanceCriteria ?? null,
    }));
  }

  private prepareAddedDrafts(
    workflowId: string,
    drafts: WorkflowPhaseDraft[],
    existingIds: Set<string>,
    basePosition: number,
  ): WorkflowPhaseCreateInput[] {
    if (!drafts.length) return [];
    const normalized = this.normalizeDrafts(drafts);
    const ids = new Map(normalized.map((phase) => [phase.ref, `phase_${randomUUID()}`]));
    const resolve = (ref: string | null | undefined): string | null => {
      if (!ref) return null;
      if (existingIds.has(ref)) return ref;
      return ids.get(ref) ?? `missing:${ref}`;
    };
    return normalized.map((phase, index) => ({
      id: ids.get(phase.ref)!,
      workflowId,
      parentPhaseId: resolve(phase.parentRef),
      title: phase.title,
      description: phase.description ?? null,
      status: 'PENDING',
      position: basePosition + index,
      dependencyIds: (phase.dependencyRefs ?? []).map((ref) => resolve(ref) ?? `missing:${ref}`),
      acceptanceCriteria: phase.acceptanceCriteria ?? null,
    }));
  }

  private async completeReadyParents(tx: any, workflowId: string, parentPhaseId: string | null): Promise<void> {
    let cursor = parentPhaseId;
    while (cursor) {
      const all = await this.phases.listByWorkflow(workflowId, tx);
      const parent = all.find((phase) => phase.id === cursor);
      if (!parent || this.phasePolicy.isTerminal(parent.status)) return;
      const children = all.filter((phase) => phase.parentPhaseId === parent.id);
      if (!children.length || children.some((phase) => phase.status !== 'COMPLETED' && phase.status !== 'SKIPPED' && phase.status !== 'CANCELLED')) return;
      await this.phases.setStatus(tx, {
        phaseId: parent.id,
        status: 'COMPLETED',
        resultSummary: 'All child phases completed.',
      });
      cursor = parent.parentPhaseId;
    }
  }

  private toCreateInput(phase: WorkflowPhaseSnapshot): WorkflowPhaseCreateInput {
    return {
      id: phase.id,
      workflowId: phase.workflowId,
      parentPhaseId: phase.parentPhaseId,
      title: phase.title,
      description: phase.description,
      status: phase.status,
      position: phase.position,
      dependencyIds: phase.dependencyIds,
      acceptanceCriteria: phase.acceptanceCriteria,
    };
  }


  private assertDependenciesSatisfied(
    phase: WorkflowPhaseSnapshot,
    phases: WorkflowPhaseSnapshot[],
  ): void {
    const byId = new Map(phases.map((item) => [item.id, item]));
    for (const dependencyId of phase.dependencyIds) {
      const dependency = byId.get(dependencyId);
      if (dependency?.status !== 'COMPLETED' && dependency?.status !== 'SKIPPED') {
        throw new Error(`WORKFLOW_PHASE_DEPENDENCY_UNSATISFIED:${phase.id}:${dependencyId}`);
      }
    }
  }

  private async requireCurrent(workflowId: string, tx: any): Promise<WorkflowRunSnapshot> {
    const run = await this.runs.findById(workflowId, tx);
    if (!run) throw new Error('WORKFLOW_NOT_FOUND');
    return run;
  }

  private async requirePhase(workflowId: string, phaseId: string, tx: any): Promise<WorkflowPhaseSnapshot> {
    const phase = await this.phases.findById(phaseId, tx);
    if (!phase || phase.workflowId !== workflowId) throw new Error('WORKFLOW_PHASE_NOT_FOUND');
    return phase;
  }

  private assertOpen(run: WorkflowRunSnapshot): void {
    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
      throw new Error('WORKFLOW_NOT_ACTIVE');
    }
  }

  private requiredText(value: unknown, code: string, max: number): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error(code);
    if (Array.from(text).length > max) throw new Error(`${code}_TOO_LONG`);
    return text;
  }

  private optionalText(value: unknown, max: number): string | null {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (Array.from(text).length > max) throw new Error('WORKFLOW_TEXT_TOO_LONG');
    return text;
  }

  private textArray(value: unknown): string[] {
    return Array.isArray(value)
      ? [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))]
      : [];
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
