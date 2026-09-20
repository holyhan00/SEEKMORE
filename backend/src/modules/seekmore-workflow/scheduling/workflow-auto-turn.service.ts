import { Injectable } from '@nestjs/common';
import { MessageRole, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { SeekmoreAgentService } from '../../seekmore-agent/seekmore-agent.service';
import type { AgentTurnExecutionResult } from '../../seekmore-agent/contracts/agent-turn.types';
import { AgentTurnFinalizationService } from '../../seekmore-agent/finalization/agent-turn-finalization.service';
import { RuntimeAssistantTimelineBus } from '../../chat/runtime-events/runtime-assistant-timeline.bus';
import { SeekmoreWorkflowFacade } from '../application/seekmore-workflow.facade';
import { WorkflowPostTurnService } from '../application/workflow-post-turn.service';
import type { WorkflowPhaseSnapshot } from '../contracts/workflow-phase.types';
import type { WorkflowRunSnapshot } from '../contracts/workflow-run.types';
import type { WorkflowScheduleReason } from './workflow-scheduler.port';
import { LocaleResolverService } from '../../localization/locale-resolver.service';

const USER_SUPERSEDE_REASON = 'workflow_auto_superseded_by_user';
const USER_TURN_STATUSES = [
  'QUEUED',
  'STARTING',
  'RUNNING',
  'WAITING_APPROVAL',
  'WAITING_EXTERNAL',
  'CANCELLING',
] as const;

interface WorkflowInternalTurnMessages {
  parentMessageId: string;
  userMessageId: string;
  assistantMessageId: string;
}

@Injectable()
export class WorkflowAutoTurnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: SeekmoreWorkflowFacade,
    private readonly agent: SeekmoreAgentService,
    private readonly finalization: AgentTurnFinalizationService,
    private readonly timeline: RuntimeAssistantTimelineBus,
    private readonly postTurn: WorkflowPostTurnService,
    private readonly localeResolver: LocaleResolverService,
  ) {}

  async execute(
    run: WorkflowRunSnapshot,
    phase: WorkflowPhaseSnapshot,
    reason: WorkflowScheduleReason = 'recovery',
  ): Promise<void> {
    if (await this.hasUserTurnActivity(run.conversationId)) return;

    const traceId = `workflow_auto_${randomUUID()}`;
    const messages = await this.createInternalTurn(run, phase, traceId, reason);
    const controller = new AbortController();
    const stopWatching = this.watchForUserTurn(run.conversationId, controller);

    try {
      const localization = await this.localeResolver.resolveForBackground({
        conversationId: run.conversationId,
      });
      if (await this.hasUserTurnActivity(run.conversationId)) {
        controller.abort(USER_SUPERSEDE_REASON);
      }
      throwIfAborted(controller.signal);

      const prepared = await this.workflow.prepareTurn({
        traceId,
        userId: run.userId,
        agentId: run.agentId,
        conversationId: run.conversationId,
        parentMessageId: messages.parentMessageId,
        userMessageId: messages.userMessageId,
        contextLeafMessageId: messages.parentMessageId,
        assistantMessageId: messages.assistantMessageId,
        input: '',
        stream: false,
        abortSignal: controller.signal,
        runtimeOptions: {
          workspaceId: run.workspaceId,
          permissionMode: run.permissionMode,
        },
        externalContext: {
          source: 'workflow_auto',
          workflowId: run.id,
          phaseId: phase.id,
          scheduleReason: reason,
        },
      });
      throwIfAborted(controller.signal);

      const result = await this.agent.runChatTurn({
        ...prepared,
        localization,
        abortSignal: controller.signal,
      });

      this.timeline.publishContent({
        userId: run.userId,
        conversationId: run.conversationId,
        assistantMessageId: messages.assistantMessageId,
        traceId,
        blockId: `workflow:${run.id}:message:${messages.assistantMessageId}:final`,
        role: 'final',
        markdown: result.content,
        final: true,
      });

      await this.commitResult(
        run,
        messages.assistantMessageId,
        messages.parentMessageId,
        traceId,
        result,
      );
      await this.postTurn.afterTurn({ traceId, outcome: result.outcome });
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason === USER_SUPERSEDE_REASON) {
        await this.finalization.commitCancelled({
          traceId,
          conversationId: run.conversationId,
          assistantMessageId: messages.assistantMessageId,
          content: '',
          finalizationKey: `${traceId}:${messages.assistantMessageId}:superseded`,
          metadata: {
            workflowAuto: true,
            supersededByUser: true,
            workflowId: run.id,
            phaseId: phase.id,
          },
          expectedCurrentLeafMessageId: messages.parentMessageId,
        });
        return;
      }

      await this.finalization.commitUnhandledFailure({
        traceId,
        conversationId: run.conversationId,
        assistantMessageId: messages.assistantMessageId,
        errorMessage: error instanceof Error ? error.message : String(error),
        content: '',
        finalizationKey: `${traceId}:${messages.assistantMessageId}:failed`,
        metadata: {
          workflowAuto: true,
          workflowId: run.id,
          phaseId: phase.id,
        },
        expectedCurrentLeafMessageId: messages.parentMessageId,
      });
      throw error;
    } finally {
      stopWatching();
    }
  }

  private async createInternalTurn(
    run: WorkflowRunSnapshot,
    phase: WorkflowPhaseSnapshot,
    traceId: string,
    reason: WorkflowScheduleReason,
  ): Promise<WorkflowInternalTurnMessages> {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: {
          id: run.conversationId,
          userId: run.userId,
          agentId: run.agentId,
          deletedAt: null,
        },
      });
      if (!conversation) throw new Error('WORKFLOW_CONVERSATION_NOT_FOUND');
      const parentMessageId = conversation.currentLeafMessageId;
      if (!parentMessageId) throw new Error('WORKFLOW_CONTEXT_LEAF_NOT_FOUND');
      const parent = await tx.message.findFirst({
        where: { id: parentMessageId, conversationId: run.conversationId },
      });
      if (!parent) throw new Error('WORKFLOW_CONTEXT_LEAF_MESSAGE_NOT_FOUND');
      const rootMessageId = parent.rootMessageId ?? parent.id;
      const branchId = parent.branchId ?? rootMessageId;

      const user = await tx.message.create({
        data: {
          conversationId: run.conversationId,
          parentMessageId,
          rootMessageId,
          branchId,
          role: MessageRole.USER,
          content: '',
          traceId,
          senderType: 'SYSTEM',
          senderUserId: null,
          senderAgentId: run.agentId,
          status: 'finished',
          unfinished: false,
          error: false,
          meta: {
            source: 'workflow_auto',
            visibility: 'internal',
            workflowId: run.id,
            phaseId: phase.id,
            scheduleReason: reason,
          } as Prisma.InputJsonValue,
        },
      });
      const assistant = await tx.message.create({
        data: {
          conversationId: run.conversationId,
          parentMessageId,
          rootMessageId,
          branchId,
          role: MessageRole.ASSISTANT,
          content: '',
          traceId,
          senderType: 'AGENT',
          senderUserId: null,
          senderAgentId: run.agentId,
          status: 'streaming',
          unfinished: true,
          error: false,
          meta: {
            source: 'workflow_auto',
            workflowId: run.id,
            phaseId: phase.id,
            scheduleReason: reason,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.conversation.update({
        where: { id: run.conversationId },
        data: {
          messageCount: { increment: 1 },
        },
      });
      return {
        parentMessageId,
        userMessageId: user.id,
        assistantMessageId: assistant.id,
      };
    });
  }

  private async commitResult(
    run: WorkflowRunSnapshot,
    assistantMessageId: string,
    parentMessageId: string,
    traceId: string,
    result: AgentTurnExecutionResult,
  ): Promise<void> {
    const resultStatus = result.outcome.kind === 'paused'
      ? result.outcome.reason
      : result.outcome.status;
    const finalizationKey = `${traceId}:${assistantMessageId}:${resultStatus}`;

    if (result.outcome.kind === 'paused') {
      await this.finalization.commitPause({
        traceId,
        conversationId: run.conversationId,
        assistantMessageId,
        content: result.content,
        citations: result.citations,
        runtime: result.runtime,
        metadata: { ...result.metadata, workflowAuto: true },
        reasonCodes: result.reasonCodes,
        pauseStatus: result.outcome.reason === 'approval'
          ? 'waiting_for_approval'
          : result.outcome.reason === 'external_dependency'
            ? 'waiting_for_external_dependency'
            : 'waiting_for_user',
        finalizationKey,
        expectedCurrentLeafMessageId: parentMessageId,
      });
      return;
    }

    const canDeliver = result.outcome.status === 'succeeded' || result.outcome.status === 'partial';
    const outputObjects = canDeliver
      ? (Array.isArray(result.objects) ? result.objects : [])
          .filter((item: any) => item?.role === 'assistant_output' && String(item?.objectId ?? '').trim())
          .map((item: any, position: number) => ({ objectId: String(item.objectId).trim(), position }))
      : [];

    await this.finalization.commitTerminal({
      traceId,
      conversationId: run.conversationId,
      assistantMessageId,
      content: result.content,
      citations: result.citations,
      runtime: result.runtime,
      metadata: { ...result.metadata, workflowAuto: true },
      reasonCodes: result.reasonCodes,
      terminalStatus: result.outcome.status === 'partial' ? 'partially_succeeded' : result.outcome.status,
      finalizationKey,
      userId: run.userId,
      agentId: run.agentId,
      outputObjects,
      expectedCurrentLeafMessageId: parentMessageId,
    });
  }

  private watchForUserTurn(
    conversationId: string,
    controller: AbortController,
  ): () => void {
    let checking = false;
    let disposed = false;

    const check = async () => {
      if (disposed || checking || controller.signal.aborted) return;
      checking = true;
      try {
        if (await this.hasUserTurnActivity(conversationId)) {
          controller.abort(USER_SUPERSEDE_REASON);
        }
      } finally {
        checking = false;
      }
    };

    const timer = setInterval(() => void check(), 250);
    timer.unref?.();
    void check();

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }

  private async hasUserTurnActivity(conversationId: string): Promise<boolean> {
    const row = await this.prisma.chatTurnRequest.findFirst({
      where: {
        conversationId,
        status: { in: [...USER_TURN_STATUSES] as any },
      },
      select: { id: true },
    });
    return Boolean(row);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error(String(signal.reason ?? 'AGENT_TURN_CANCELLED'));
  error.name = 'AbortError';
  throw error;
}
