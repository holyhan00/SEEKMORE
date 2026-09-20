import { Injectable, Logger } from '@nestjs/common';
import { MessageRole, Prisma, type Automation } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { SeekmoreAgentService } from '../seekmore-agent/seekmore-agent.service';
import type { AgentTurnExecutionResult } from '../seekmore-agent/contracts/agent-turn.types';
import { AgentTurnFinalizationService } from '../seekmore-agent/finalization/agent-turn-finalization.service';
import { RuntimeAssistantTimelineBus } from '../chat/runtime-events/runtime-assistant-timeline.bus';
import { ChatObjectProjectionService } from '../chat/object-projection/chat-object-projection.service';
import { ChatTurnDeliveryBus } from '../chat/turn/chat-turn-delivery.bus';
import { AutomationRealtimeBus } from './automation-realtime.bus';
import { AutomationService } from './automation.service';
import { LocaleResolverService } from '../localization/locale-resolver.service';

const CHAT_BUSY_STATUSES = [
  'QUEUED',
  'STARTING',
  'RUNNING',
  'WAITING_APPROVAL',
  'WAITING_EXTERNAL',
  'CANCELLING',
] as const;

type AutomationTurnMessageEnvelope = {
  id: string;
  conversationId: string;
  role: 'agent';
  parentMessageId: string | null;
  rootMessageId: string | null;
  branchId: string | null;
  content: string;
  createdAt: string;
  is_complete: boolean;
  traceId: string;
  meta: Record<string, unknown>;
};

type PreparedMessages = {
  kind: 'ready';
  parentMessageId: string;
  userMessageId: string;
  assistantMessageId: string;
  assistantMessage: AutomationTurnMessageEnvelope;
};

type PrepareMessagesResult = PreparedMessages | { kind: 'busy' } | { kind: 'stopped' };

@Injectable()
export class AutomationRunnerService {
  private readonly logger = new Logger(AutomationRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationService,
    private readonly agent: SeekmoreAgentService,
    private readonly finalization: AgentTurnFinalizationService,
    private readonly timeline: RuntimeAssistantTimelineBus,
    private readonly objects: ChatObjectProjectionService,
    private readonly turnDelivery: ChatTurnDeliveryBus,
    private readonly realtime: AutomationRealtimeBus,
    private readonly localeResolver: LocaleResolverService,
  ) {}

  async publishExpiryNotice(automation: Automation): Promise<boolean> {
    const message = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtext(${automation.conversationId}))::text AS "lock"
      `);
      const [freshAutomation, conversation, activeChatTurn, unfinishedMessage, runningAutomation] = await Promise.all([
        tx.automation.findFirst({
          where: {
            id: automation.id,
            status: 'COMPLETED',
            completionReason: 'EXPIRED',
            expiryNoticeSentAt: null,
            conversation: { deletedAt: null },
          },
          select: { id: true },
        }),
        tx.conversation.findFirst({
          where: { id: automation.conversationId, userId: automation.userId, deletedAt: null },
          select: { currentLeafMessageId: true },
        }),
        tx.chatTurnRequest.findFirst({
          where: { conversationId: automation.conversationId, status: { in: [...CHAT_BUSY_STATUSES] as any } },
          select: { id: true },
        }),
        tx.message.findFirst({
          where: { conversationId: automation.conversationId, unfinished: true, deletedAt: null },
          select: { id: true },
        }),
        tx.automationRun.findFirst({
          where: {
            status: 'RUNNING',
            assistantMessageId: { not: null },
            automation: { conversationId: automation.conversationId },
          },
          select: { id: true },
        }),
      ]);
      if (!freshAutomation || !conversation?.currentLeafMessageId || activeChatTurn || unfinishedMessage || runningAutomation) return null;
      const parent = await tx.message.findFirst({
        where: { id: conversation.currentLeafMessageId, conversationId: automation.conversationId, deletedAt: null },
        select: { id: true, rootMessageId: true, branchId: true },
      });
      if (!parent) return null;
      const rootMessageId = parent.rootMessageId ?? parent.id;
      const branchId = parent.branchId ?? rootMessageId;
      const created = await tx.message.create({
        data: {
          conversationId: automation.conversationId,
          parentMessageId: parent.id,
          rootMessageId,
          branchId,
          role: MessageRole.ASSISTANT,
          content: `Automation ended
“${automation.title}” reached its configured end time and will no longer run automatically.`,
          senderType: 'AGENT',
          senderUserId: null,
          senderAgentId: automation.agentId,
          status: 'finished',
          unfinished: false,
          error: false,
          finishReason: 'succeeded',
          meta: {
            source: 'automation_lifecycle',
            automationId: automation.id,
            lifecycleEvent: 'expired',
            presentation: {
              key: 'automation.message.expired',
              params: { title: automation.title },
            },
          } as Prisma.InputJsonValue,
        },
      });
      await tx.conversation.update({
        where: { id: automation.conversationId },
        data: { messageCount: { increment: 1 }, currentLeafMessageId: created.id, lastMessageAt: new Date() },
      });
      await tx.automation.updateMany({
        where: { id: automation.id, expiryNoticeSentAt: null },
        data: { expiryNoticeSentAt: new Date() },
      });
      return created;
    });
    if (!message) return false;
    await this.publishMessage(automation, message.id);
    return true;
  }

  async execute(runId: string): Promise<void> {
    const traceId = `automation_${randomUUID()}`;
    const prepared = await this.automations.prepareRun(runId, traceId);
    if (!prepared) return;

    const automation = prepared.automation;
    const messages = await this.prepareMessages(runId, automation, traceId);
    if (messages.kind === 'busy') {
      await this.automations.markRunPending(runId);
      return;
    }
    if (messages.kind === 'stopped') {
      await this.automations.finishRun({ runId, outcome: 'CANCELLED' }).catch(() => undefined);
      return;
    }

    this.publishTurnStarted({
      automation,
      runId,
      traceId,
      messages,
    });

    try {
      const localization = await this.localeResolver.resolveForBackground({
        conversationId: automation.conversationId,
        timeZone: this.automationTimeZone(automation),
      });
      const result = await this.agent.runChatTurn({
        traceId,
        userId: automation.userId,
        agentId: automation.agentId,
        conversationId: automation.conversationId,
        parentMessageId: messages.parentMessageId,
        userMessageId: messages.userMessageId,
        contextLeafMessageId: messages.parentMessageId,
        assistantMessageId: messages.assistantMessageId,
        input: automation.instruction,
        stream: false,
        localization,
        externalContext: this.externalContext(automation, runId, prepared.run.scheduledFor),
      });

      const latestBeforeDelivery = await this.automations.automationForRun(runId);
      const deliver = this.shouldDeliverResult(
        latestBeforeDelivery?.automation ?? automation,
        result,
      );

      if (deliver && result.content) {
        this.timeline.publishContent({
          userId: automation.userId,
          conversationId: automation.conversationId,
          assistantMessageId: messages.assistantMessageId,
          traceId,
          blockId: `automation:${automation.id}:run:${runId}:final`,
          role: 'final',
          markdown: result.content,
          final: true,
        });
      }

      const advancedLeaf = await this.currentLeaf(automation.conversationId);
      const outcome = await this.commitResult(
        latestBeforeDelivery?.automation ?? automation,
        runId,
        messages.assistantMessageId,
        traceId,
        result,
        deliver,
      );

      if (deliver) {
        await this.restoreAdvancedLeaf(
          automation.conversationId,
          messages.assistantMessageId,
          advancedLeaf,
        );
      } else {
        await this.hideSuppressedMessage({
          conversationId: automation.conversationId,
          assistantMessageId: messages.assistantMessageId,
          restoreLeafMessageId: advancedLeaf && advancedLeaf !== messages.assistantMessageId
            ? advancedLeaf
            : messages.parentMessageId,
          originalParentMessageId: messages.parentMessageId,
        });
      }

      await this.automations.finishRun({ runId, outcome });
      await this.publishTurnTerminal({
        automation: latestBeforeDelivery?.automation ?? automation,
        runId,
        traceId,
        assistantMessageId: messages.assistantMessageId,
        outcome,
        deliver,
        runtime: result.runtime,
      });

      if (deliver) {
        await this.publishMessage(automation, messages.assistantMessageId);
      } else {
        this.realtime.hidden({
          userId: automation.userId,
          conversationId: automation.conversationId,
          messageId: messages.assistantMessageId,
        });
      }
    } catch (error) {
      await this.handleFailure({ automation, runId, traceId, assistantMessageId: messages.assistantMessageId, error });
    }
  }

  private async prepareMessages(
    runId: string,
    automation: Automation,
    traceId: string,
  ): Promise<PrepareMessagesResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtext(${automation.conversationId}))::text AS "lock"
      `);

      const [conversation, run, activeChatTurn, unfinishedMessage, otherAutomationRun] = await Promise.all([
        tx.conversation.findFirst({
          where: {
            id: automation.conversationId,
            userId: automation.userId,
            agentId: automation.agentId,
            deletedAt: null,
          },
          select: { id: true, currentLeafMessageId: true },
        }),
        tx.automationRun.findFirst({
          where: { id: runId, automationId: automation.id, status: 'RUNNING', traceId },
          select: { id: true },
        }),
        tx.chatTurnRequest.findFirst({
          where: {
            conversationId: automation.conversationId,
            status: { in: [...CHAT_BUSY_STATUSES] as any },
          },
          select: { id: true },
        }),
        tx.message.findFirst({
          where: { conversationId: automation.conversationId, unfinished: true, deletedAt: null },
          select: { id: true },
        }),
        tx.automationRun.findFirst({
          where: {
            id: { not: runId },
            status: 'RUNNING',
            assistantMessageId: { not: null },
            automation: { conversationId: automation.conversationId },
          },
          select: { id: true },
        }),
      ]);

      if (!conversation || !run) return { kind: 'stopped' };
      if (activeChatTurn || unfinishedMessage || otherAutomationRun) return { kind: 'busy' };

      const parentMessageId = conversation.currentLeafMessageId;
      if (!parentMessageId) return { kind: 'stopped' };
      const parent = await tx.message.findFirst({
        where: { id: parentMessageId, conversationId: automation.conversationId, deletedAt: null },
        select: { id: true, rootMessageId: true, branchId: true },
      });
      if (!parent) return { kind: 'stopped' };

      const rootMessageId = parent.rootMessageId ?? parent.id;
      const branchId = parent.branchId ?? rootMessageId;
      const user = await tx.message.create({
        data: {
          conversationId: automation.conversationId,
          parentMessageId,
          rootMessageId,
          branchId,
          role: MessageRole.USER,
          content: '',
          traceId,
          senderType: 'SYSTEM',
          senderUserId: null,
          senderAgentId: automation.agentId,
          status: 'finished',
          unfinished: false,
          error: false,
          meta: {
            source: 'automation',
            visibility: 'internal',
            automationId: automation.id,
            automationRunId: runId,
          } as Prisma.InputJsonValue,
        },
      });
      const assistant = await tx.message.create({
        data: {
          conversationId: automation.conversationId,
          parentMessageId,
          rootMessageId,
          branchId,
          role: MessageRole.ASSISTANT,
          content: '',
          traceId,
          senderType: 'AGENT',
          senderUserId: null,
          senderAgentId: automation.agentId,
          status: 'streaming',
          unfinished: true,
          error: false,
          meta: {
            source: 'automation',
            automationId: automation.id,
            automationRunId: runId,
            deliveryMode: this.automations.policyOf(automation).deliveryPolicy.mode,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.automationRun.update({
        where: { id: runId },
        data: { userMessageId: user.id, assistantMessageId: assistant.id },
      });
      await tx.conversation.update({
        where: { id: automation.conversationId },
        data: {
          messageCount: { increment: 1 },
          currentLeafMessageId: assistant.id,
          lastMessageAt: new Date(),
        },
      });

      return {
        kind: 'ready',
        parentMessageId,
        userMessageId: user.id,
        assistantMessageId: assistant.id,
        assistantMessage: this.toAutomationTurnMessageEnvelope({
          message: assistant,
          traceId,
          complete: false,
        }),
      };
    });
  }

  private automationTimeZone(automation: Automation): string | null {
    const trigger = automation.trigger && typeof automation.trigger === 'object' && !Array.isArray(automation.trigger)
      ? automation.trigger as Record<string, unknown>
      : {};
    const timeZone = String(trigger.timeZone ?? '').trim();
    return timeZone || null;
  }

  private externalContext(automation: Automation, runId: string, scheduledFor: Date): Record<string, unknown> {
    const policy = this.automations.policyOf(automation);
    const completionCondition = policy.stopPolicy.completionCondition ?? null;
    const deliveryMode = policy.deliveryPolicy.mode;
    return {
      source: 'automation',
      automationId: automation.id,
      automationRunId: runId,
      scheduledFor: scheduledFor.toISOString(),
      instruction: automation.instruction,
      completionCondition,
      deliveryPolicy: policy.deliveryPolicy,
      lifecycleInstruction: completionCondition
        ? deliveryMode === 'on_completion'
          ? 'Check the requested condition. If it is definitively satisfied, call automation.complete before giving the final answer. If it is not satisfied, finish the check normally; this run is intentionally silent to the user.'
          : 'If the completion condition is definitively satisfied, call automation.complete before giving the final answer. Report this run normally whether or not the condition is satisfied.'
        : 'Complete the scheduled work and report the result normally. Do not create a replacement automation unless the user explicitly asked for one.',
    };
  }

  private async commitResult(
    automation: Automation,
    runId: string,
    assistantMessageId: string,
    traceId: string,
    result: AgentTurnExecutionResult,
    deliver: boolean,
  ): Promise<'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED'> {
    if (result.outcome.kind === 'paused') {
      await (this.prisma as any).agentApproval.updateMany({
        where: { traceId, status: 'pending' },
        data: {
          status: 'cancelled',
          errorJson: { message: 'automation run paused; resume by starting the automation again after resolving access requirements' },
        },
      }).catch(() => undefined);
      const content = result.content || 'This automation needs user action and has been paused.';
      await this.finalization.commitTerminal({
        traceId,
        conversationId: automation.conversationId,
        assistantMessageId,
        content,
        citations: result.citations,
        runtime: result.runtime,
        metadata: {
          ...result.metadata,
          automationRun: true,
          automationId: automation.id,
          automationRunId: runId,
          ...(!result.content ? { presentation: { key: 'automation.message.blocked' } } : {}),
        },
        reasonCodes: [...result.reasonCodes, `automation:paused:${result.outcome.reason}`],
        terminalStatus: 'blocked',
        finalizationKey: `${traceId}:${assistantMessageId}:blocked`,
        userId: automation.userId,
        agentId: automation.agentId,
        outputObjects: [],
      });
      return 'BLOCKED';
    }

    const canDeliver = result.outcome.status === 'succeeded' || result.outcome.status === 'partial';
    const outputObjects = deliver && canDeliver
      ? (Array.isArray(result.objects) ? result.objects : [])
          .filter((item: any) => item?.role === 'assistant_output' && String(item?.objectId ?? '').trim())
          .map((item: any, position: number) => ({ objectId: String(item.objectId).trim(), position }))
      : [];

    const fallbackPresentation = !result.content
      ? result.outcome.status === 'blocked'
        ? { key: 'automation.message.blocked' }
        : result.outcome.status === 'cancelled'
          ? { key: automation.status === 'PAUSED' ? 'automation.message.paused' : 'automation.message.cancelled' }
          : result.outcome.status === 'failed'
            ? { key: 'automation.message.failed' }
            : null
      : null;
    const content = result.content || (result.outcome.status === 'blocked'
      ? 'This automation needs user action and has been paused.'
      : result.outcome.status === 'cancelled'
        ? automation.status === 'PAUSED'
          ? 'The automation is paused. This run has stopped.'
          : 'The automation has ended. This run has stopped.'
        : result.outcome.status === 'failed'
          ? 'This automation run failed.'
          : '');

    await this.finalization.commitTerminal({
      traceId,
      conversationId: automation.conversationId,
      assistantMessageId,
      content,
      citations: result.citations,
      runtime: result.runtime,
      metadata: {
        ...result.metadata,
        automationRun: true,
        automationId: automation.id,
        automationRunId: runId,
        ...(fallbackPresentation ? { presentation: fallbackPresentation } : {}),
      },
      reasonCodes: result.reasonCodes,
      terminalStatus: result.outcome.status === 'partial' ? 'partially_succeeded' : result.outcome.status,
      finalizationKey: `${traceId}:${assistantMessageId}:${result.outcome.status}`,
      userId: automation.userId,
      agentId: automation.agentId,
      outputObjects,
    });

    if (result.outcome.status === 'succeeded' || result.outcome.status === 'partial') return 'SUCCEEDED';
    if (result.outcome.status === 'blocked') return 'BLOCKED';
    if (result.outcome.status === 'cancelled') return 'CANCELLED';
    return 'FAILED';
  }

  private shouldDeliverResult(automation: Automation, result: AgentTurnExecutionResult): boolean {
    const status = result.outcome.kind === 'terminal' ? result.outcome.status : null;
    const successful = status === 'succeeded' || status === 'partial';
    if (!successful) return true;

    const deliveryPolicy = this.automations.policyOf(automation).deliveryPolicy;
    if (deliveryPolicy.mode !== 'on_completion') return true;

    return automation.status === 'COMPLETED';
  }

  private async hideSuppressedMessage(input: {
    conversationId: string;
    assistantMessageId: string;
    restoreLeafMessageId: string;
    originalParentMessageId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const [message, restoreLeaf] = await Promise.all([
        tx.message.findFirst({
          where: {
            id: input.assistantMessageId,
            conversationId: input.conversationId,
            deletedAt: null,
          },
          select: { meta: true },
        }),
        tx.message.findFirst({
          where: {
            id: input.restoreLeafMessageId,
            conversationId: input.conversationId,
            deletedAt: null,
          },
          select: { id: true, timestamp: true },
        }),
      ]);
      if (!message || !restoreLeaf) return;

      await tx.message.update({
        where: { id: input.assistantMessageId },
        data: {
          content: '',
          citations: Prisma.JsonNull,
          meta: {
            ...record(message.meta),
            visibility: 'internal',
            deliverySuppressed: true,
          } as Prisma.InputJsonValue,
        },
      });

                                                                          
                                                                           
                                                                             
                                                                        
      await tx.message.updateMany({
        where: {
          conversationId: input.conversationId,
          parentMessageId: input.assistantMessageId,
          deletedAt: null,
        },
        data: { parentMessageId: input.originalParentMessageId },
      });

      const restored = await tx.conversation.updateMany({
        where: {
          id: input.conversationId,
          currentLeafMessageId: input.assistantMessageId,
          deletedAt: null,
        },
        data: {
          currentLeafMessageId: restoreLeaf.id,
          messageCount: { decrement: 1 },
          lastMessageAt: restoreLeaf.timestamp,
        },
      });
      if (restored.count === 0) {
        await tx.conversation.updateMany({
          where: { id: input.conversationId, deletedAt: null },
          data: { messageCount: { decrement: 1 } },
        });
      }
    });
  }

  private publishTurnStarted(input: {
    automation: Automation;
    runId: string;
    traceId: string;
    messages: PreparedMessages;
  }): void {
    this.turnDelivery.publish({
      type: 'chat.turn.started',
      userId: input.automation.userId,
      conversationId: input.automation.conversationId,
      requestId: input.runId,
      traceId: input.traceId,
      payload: {
        source: 'automation',
        automationId: input.automation.id,
        automationRunId: input.runId,
        agentId: input.automation.agentId,
        status: 'RUNNING',
        userMessageId: null,
        assistantMessageId: input.messages.assistantMessageId,
        assistantMessage: input.messages.assistantMessage,
      },
    });
  }

  private async publishTurnTerminal(input: {
    automation: Automation;
    runId: string;
    traceId: string;
    assistantMessageId: string;
    outcome: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
    deliver: boolean;
    runtime?: Record<string, unknown> | null;
  }): Promise<void> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.assistantMessageId,
        conversationId: input.automation.conversationId,
        deletedAt: null,
        conversation: { deletedAt: null },
      },
    });
    if (!message) return;

    const meta = record(message.meta);
    const objects = input.deliver
      ? await this.objects.projectMessage({
          userId: input.automation.userId,
          conversationId: input.automation.conversationId,
          messageId: input.assistantMessageId,
        })
      : [];
    const content = input.deliver
      ? String(message.content ?? '')
      : '';
    const citations = input.deliver && Array.isArray(message.citations)
      ? message.citations
      : null;
    const type = input.outcome === 'CANCELLED'
      ? 'chat.turn.cancelled'
      : input.outcome === 'FAILED'
        ? 'chat.response.failed'
        : 'chat.response.completed';

    this.turnDelivery.publish({
      type,
      userId: input.automation.userId,
      conversationId: input.automation.conversationId,
      requestId: input.runId,
      traceId: input.traceId,
      payload: {
        source: 'automation',
        automationId: input.automation.id,
        automationRunId: input.runId,
        agentId: input.automation.agentId,
        status: input.outcome,
        userMessageId: null,
        assistantMessageId: input.assistantMessageId,
        assistantMessage: this.toAutomationTurnMessageEnvelope({
          message,
          traceId: input.traceId,
          complete: true,
          content,
        }),
        content,
        citations,
        objects,
        runtime:
          input.runtime
          ?? recordOrNull(meta.runtime),
      },
    });
  }

  private toAutomationTurnMessageEnvelope(input: {
    message: {
      id: string;
      conversationId: string;
      parentMessageId?: string | null;
      rootMessageId?: string | null;
      branchId?: string | null;
      content?: unknown;
      timestamp?: Date | string | number | null;
      createdAt?: Date | string | number | null;
      meta?: unknown;
    };
    traceId: string;
    complete: boolean;
    content?: string;
  }): AutomationTurnMessageEnvelope {
    const timestamp =
      input.message.timestamp
      ?? input.message.createdAt
      ?? Date.now();
    const createdAt = timestamp instanceof Date
      ? timestamp.toISOString()
      : new Date(timestamp).toISOString();

    return {
      id: String(input.message.id),
      conversationId: String(input.message.conversationId),
      role: 'agent',
      parentMessageId: input.message.parentMessageId
        ? String(input.message.parentMessageId)
        : null,
      rootMessageId: input.message.rootMessageId
        ? String(input.message.rootMessageId)
        : null,
      branchId: input.message.branchId
        ? String(input.message.branchId)
        : null,
      content: input.content ?? String(input.message.content ?? ''),
      createdAt,
      is_complete: input.complete,
      traceId: input.traceId,
      meta: record(input.message.meta),
    };
  }

  private async handleFailure(input: {
    automation: Automation;
    runId: string;
    traceId: string;
    assistantMessageId: string;
    error: unknown;
  }): Promise<void> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    const row = await this.automations.automationForRun(input.runId).catch(() => null);
    const cancelled = row?.automation.status === 'CANCELLED' || row?.automation.status === 'PAUSED' || row?.run.status === 'CANCELLING';
    const conversationDeleted = row?.automation.cancelReason === 'conversation_deleted';

    const advancedLeaf = await this.currentLeaf(input.automation.conversationId).catch(() => null);
    const assistantExists = await this.prisma.message.findUnique({ where: { id: input.assistantMessageId }, select: { id: true } }).catch(() => null);
    let terminalMessageReady = false;

    if (assistantExists && !conversationDeleted) {
      if (cancelled) {
        const paused = row?.automation.status === 'PAUSED';
        const cancellationContent = paused
          ? 'The automation is paused. This run has stopped.'
          : 'The automation has ended. This run has stopped.';
        await this.finalization.commitCancelled({
          traceId: input.traceId,
          conversationId: input.automation.conversationId,
          assistantMessageId: input.assistantMessageId,
          content: cancellationContent,
          metadata: { presentation: { key: paused ? 'automation.message.paused' : 'automation.message.cancelled' } },
          finalizationKey: `${input.traceId}:${input.assistantMessageId}:cancelled`,
        }).catch(() => undefined);
      } else {
        await this.finalization.commitUnhandledFailure({
          traceId: input.traceId,
          conversationId: input.automation.conversationId,
          assistantMessageId: input.assistantMessageId,
          errorMessage: message,
          content: 'This automation run failed.',
          metadata: { presentation: { key: 'automation.message.failed' } },
          finalizationKey: `${input.traceId}:${input.assistantMessageId}:failed`,
        }).catch(() => undefined);
      }
      await this.restoreAdvancedLeaf(input.automation.conversationId, input.assistantMessageId, advancedLeaf).catch(() => undefined);
      terminalMessageReady = true;
    }

    await this.automations.finishRun({
      runId: input.runId,
      outcome: cancelled ? 'CANCELLED' : 'FAILED',
      errorCode: cancelled ? 'AUTOMATION_CANCELLED' : 'AUTOMATION_RUN_FAILED',
      errorMessage: message,
    }).catch(() => undefined);

    if (terminalMessageReady) {
      await this.publishTurnTerminal({
        automation: row?.automation ?? input.automation,
        runId: input.runId,
        traceId: input.traceId,
        assistantMessageId: input.assistantMessageId,
        outcome: cancelled ? 'CANCELLED' : 'FAILED',
        deliver: true,
        runtime: null,
      }).catch(() => undefined);
      await this.publishMessage(input.automation, input.assistantMessageId).catch(() => undefined);
    }

    if (!cancelled) {
      this.logger.warn(`Automation run failed automation=${input.automation.id} run=${input.runId}: ${message}`);
    }
  }

  private async currentLeaf(conversationId: string): Promise<string | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { currentLeafMessageId: true },
    });
    return conversation?.currentLeafMessageId ?? null;
  }

  private async restoreAdvancedLeaf(
    conversationId: string,
    automationAssistantMessageId: string,
    leafBeforeFinalize: string | null,
  ): Promise<void> {
    if (!leafBeforeFinalize || leafBeforeFinalize === automationAssistantMessageId) return;
    const leaf = await this.prisma.message.findFirst({
      where: {
        id: leafBeforeFinalize,
        conversationId,
        deletedAt: null,
      },
      select: { id: true, timestamp: true },
    });
    if (!leaf) return;
    await this.prisma.conversation.updateMany({
      where: { id: conversationId, currentLeafMessageId: automationAssistantMessageId, deletedAt: null },
      data: { currentLeafMessageId: leaf.id, lastMessageAt: leaf.timestamp },
    });
  }

  private async publishMessage(automation: Automation, messageId: string): Promise<void> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId: automation.conversationId,
        deletedAt: null,
        conversation: { deletedAt: null },
      },
    });
    if (!message || message.unfinished) return;
    const objects = await this.objects.projectMessage({
      userId: automation.userId,
      conversationId: automation.conversationId,
      messageId,
    });
    const meta = record(message.meta);
    this.realtime.message({
      userId: automation.userId,
      conversationId: automation.conversationId,
      message: {
        conversationId: automation.conversationId,
        id: message.id,
        parentMessageId: message.parentMessageId ?? null,
        rootMessageId: message.rootMessageId ?? null,
        branchId: message.branchId ?? null,
        branchable: true,
        role: 'agent',
        content: message.content,
        timestamp: message.timestamp.getTime(),
        is_complete: true,
        isMe: false,
        senderType: 'AGENT',
        senderAgentId: message.senderAgentId ?? automation.agentId,
        citations: Array.isArray(message.citations) ? message.citations : null,
        objects,
        runtime: recordOrNull(meta.runtime),
        meta,
      },
    });
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function recordOrNull(value: unknown): Record<string, unknown> | null {
  const output = record(value);
  return Object.keys(output).length ? output : null;
}
