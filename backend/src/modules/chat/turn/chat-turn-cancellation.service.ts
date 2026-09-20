import { AgentTurnFinalizationService } from '../../seekmore-agent/finalization/agent-turn-finalization.service';
import { AgentTurnRepository } from '../../seekmore-agent/persistence/agent-turn.repository';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ChatTurnDeliveryBus } from './chat-turn-delivery.bus';
import { ChatTurnExecutionRegistry } from './chat-turn-execution.registry';
import { ChatTurnOrchestratorService } from './chat-turn-orchestrator.service';
import { ChatTurnRequestRepository } from './chat-turn-request.repository';
import type { StopChatTurnCommand } from './chat-turn-request.types';
import { TurnResourceRegistry } from '../../runtime-cancellation/turn-resource.registry';

@Injectable()
export class ChatTurnCancellationService implements OnModuleInit {
  private orchestrator!: ChatTurnOrchestratorService;

  constructor(
    private readonly finalization: AgentTurnFinalizationService,
    private readonly turns: AgentTurnRepository,
    private readonly requests: ChatTurnRequestRepository,
    private readonly executions: ChatTurnExecutionRegistry,
    private readonly delivery: ChatTurnDeliveryBus,
    private readonly moduleRef: ModuleRef,
    private readonly resources: TurnResourceRegistry,
  ) {}

  onModuleInit(): void {
    this.orchestrator = this.moduleRef.get(ChatTurnOrchestratorService, { strict: false });
  }

  async stopActiveTurn(command: StopChatTurnCommand) {
    if (!command.expectedTraceId && !command.expectedRequestId) return { ok: false as const, code: 'STOP_TARGET_REQUIRED', message: 'STOP_TARGET_REQUIRED' };
    const active = await this.requests.findActive(command.conversationId);
    if (!active) return { ok: true as const, status: 'NOT_ACTIVE' as const, traceId: null };
    if (active.userId !== command.userId) return { ok: false as const, code: 'ACCESS_DENIED' as const, message: 'ACCESS_DENIED' };
    if (command.expectedRequestId && active.id !== command.expectedRequestId) return { ok: false as const, code: 'STALE_REQUEST', message: 'STALE_REQUEST' };
    if (command.expectedTraceId && active.traceId !== command.expectedTraceId) return { ok: false as const, code: 'STALE_TRACE' as const, message: 'STALE_TRACE' };
    if (!active.traceId) return { ok: false as const, code: 'STOP_TARGET_NOT_READY', message: 'STOP_TARGET_NOT_READY' };
    const cancelling = await this.requests.markCancelling(active.id, active.traceId, command.reason);
    if (!cancelling) {
      const latest = await this.requests.findById(active.id);
      return { ok: true as const, status: latest?.status === 'CANCELLING' ? 'CANCELLING' as const
        : latest?.status === 'CANCELLED' ? 'CANCELLED' as const : 'TERMINAL' as const, traceId: active.traceId };
    }
    this.delivery.publish({
      type: 'chat.turn.cancel_requested', userId: command.userId, conversationId: command.conversationId,
      requestId: active.id, traceId: active.traceId, payload: { status: 'CANCELLING', reason: command.reason },
    });
    const ownedExecution = this.executions.requestStop(active.traceId, command.reason);
    await this.resources.cancelTrace(active.traceId, command.reason);
    if (!ownedExecution) {
      await this.turns.cancel(active.traceId, command.reason);
      if (active.assistantMessageId) {
        const turn = await this.turns.findByTrace(active.traceId);
        await this.finalization.commitCancelled({ traceId: active.traceId, conversationId: command.conversationId,
          assistantMessageId: active.assistantMessageId, content: String((turn?.resultJson as any)?.content ?? ''),
          finalizationKey: `${active.traceId}:${active.assistantMessageId}:cancelled` });
      }
      const terminal = await this.requests.markTerminal({
        requestId: active.id, traceId: active.traceId, status: 'CANCELLED', cleanupStatus: 'CONFIRMED',
      });
      if (terminal) {
        this.delivery.publish({
          type: 'chat.turn.cancelled', userId: command.userId, conversationId: command.conversationId,
          requestId: active.id, traceId: active.traceId, payload: { status: 'CANCELLED', reason: command.reason },
        });
        await this.orchestrator.publishSnapshot(command.userId, command.conversationId, 'chat.queue.updated', active.id);
        this.orchestrator.scheduleDrain(command.conversationId);
        return { ok: true as const, status: 'CANCELLED' as const, traceId: active.traceId };
      }
    }
    return { ok: true as const, status: 'CANCELLING' as const, traceId: active.traceId };
  }
}
