import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentTurnRepository } from '../../seekmore-agent/persistence/agent-turn.repository';
import { UserLlmConfigResolverService } from '../../llm-settings/application/user-llm-config-resolver.service';
import { RuntimeObjectService } from '../../object-runtime/object/object.service';
import { ChatConversationRepository } from '../persistence/chat-conversation.repository';
import { ChatTurnService } from './chat-turn.service';
import { ChatTurnDeliveryBus } from './chat-turn-delivery.bus';
import { ChatTurnExecutionRegistry } from './chat-turn-execution.registry';
import { ChatTurnRequestRepository } from './chat-turn-request.repository';
import type {
  ChatTurnQueueSnapshot,
  SubmitChatTurnCommand,
} from './chat-turn-request.types';

import type { ChatTurnAnchors } from './chat-turn.types';

@Injectable()
export class ChatTurnOrchestratorService {
  private readonly scheduled = new Set<string>();

  constructor(
    private readonly agentTurns: AgentTurnRepository,
    private readonly requests: ChatTurnRequestRepository,
    private readonly executions: ChatTurnExecutionRegistry,
    private readonly delivery: ChatTurnDeliveryBus,
    private readonly turns: ChatTurnService,
    private readonly conversations: ChatConversationRepository,
    private readonly userLlmConfig: UserLlmConfigResolverService,
    private readonly objects: RuntimeObjectService,
  ) {}

  async submit(command: SubmitChatTurnCommand) {
    if (!command.clientMessageId.trim() || !command.conversationId.trim() || !command.agentId.trim()) {
      throw new BadRequestException('CHAT_TURN_INVALID_IDENTITY');
    }
    const content = command.content.trim();
    const objectRefs: Array<{ objectId: string; position: number }> = [];
    const seenObjectIds = new Set<string>();
    const seenPositions = new Set<number>();
    for (const ref of command.objectRefs) {
      const objectId = String(ref?.objectId ?? '').trim();
      const position = Number(ref?.position);
      if (!objectId || !Number.isInteger(position) || position < 0) {
        throw new BadRequestException('OBJECT_REFERENCE_INVALID');
      }
      if (seenObjectIds.has(objectId) || seenPositions.has(position)) {
        throw new BadRequestException('OBJECT_REFERENCE_DUPLICATE');
      }
      seenObjectIds.add(objectId);
      seenPositions.add(position);
      objectRefs.push({ objectId, position });
    }
    objectRefs.sort((a, b) => a.position - b.position);
    if (!content && objectRefs.length === 0) throw new BadRequestException('CHAT_TURN_INPUT_REQUIRED');
    const conversation = await this.conversations.assertUserAccess({
      userId: command.userId,
      conversationId: command.conversationId,
    });
    if (String((conversation as any).agentId) !== command.agentId) {
      throw new BadRequestException('CHAT_TURN_AGENT_MISMATCH');
    }
    if (objectRefs.length > 0) {
      const cards = await this.objects.inspectCardsByIds(
        {
          userId: command.userId,
          agentId: command.agentId,
          conversationId: command.conversationId,
        },
        objectRefs.map((ref) => ref.objectId),
      );
      const notReady = objectRefs
        .map((ref) => ref.objectId)
        .filter((objectId) => {
          const card = cards.get(objectId);
          return !card
            || card.processingStatus !== 'ready'
            || !card.readyForMessageInput;
        });
      if (notReady.length > 0) {
        throw new BadRequestException({ code: 'OBJECT_NOT_READY_OR_INACCESSIBLE', message: 'OBJECT_NOT_READY_OR_INACCESSIBLE', params: { ids: notReady.join(', ') } });
      }
    }
    const retry = command.expectedTraceId ? await this.requests.findByClientInput(command.conversationId, command.clientMessageId) : null;
    if (retry) return { ok: true as const, ...this.requests.view(retry), queuePosition: 0 };
    if (command.expectedTraceId) {
      const accepted = await this.agentTurns.appendInput({
        traceId: command.expectedTraceId, userId: command.userId, conversationId: command.conversationId,
        clientInputId: command.clientMessageId, content, objectRefs,
      });
      const row = accepted.input;
      this.delivery.publish({ type: 'chat.turn.input', userId: command.userId, conversationId: command.conversationId,
        requestId: '', traceId: command.expectedTraceId,
        payload: await this.projectInput(row, accepted.turn) });
      await this.resumeWaitingUser(command.conversationId);
      return { ok: true as const, requestId: '', clientMessageId: command.clientMessageId,
        conversationId: command.conversationId, traceId: command.expectedTraceId, status: row.kind,
        sequence: String(row.sequence), version: 1, queuePosition: 0 };
    }
    await this.userLlmConfig.resolve({
      userId: command.userId,
      requestedModelKey: command.model,
    });
    const submitted = await this.requests.submit({
      ...command,
      content,
      objectRefs,
      explicitSkillIds: [...new Set(command.explicitSkillIds.map((id) => id.trim()).filter(Boolean))].slice(0, 20),
    });
    const view = this.requests.view(submitted.request, submitted.queuePosition);
    this.delivery.publish({
      type: 'chat.turn.accepted', userId: command.userId, conversationId: command.conversationId,
      requestId: view.requestId, traceId: view.traceId, payload: view,
    });
    await this.publishSnapshot(command.userId, command.conversationId, 'chat.queue.updated', view.requestId);
    this.scheduleDrain(command.conversationId);
    return {
      ok: true as const,
      requestId: view.requestId,
      clientMessageId: view.clientMessageId,
      conversationId: view.conversationId,
      traceId: view.traceId,
      status: view.status,
      queuePosition: submitted.queuePosition,
      sequence: view.sequence,
      version: view.version,
    };
  }

  scheduleDrain(conversationId: string): void {
    if (!conversationId || this.scheduled.has(conversationId)) return;
    this.scheduled.add(conversationId);
    queueMicrotask(() => {
      this.scheduled.delete(conversationId);
      void this.drainConversation(conversationId);
    });
  }

  async drainConversation(conversationId: string): Promise<void> {
    const request = await this.requests.claimNext(conversationId);
    if (!request?.traceId) return;
    await this.publishSnapshot(request.userId, conversationId, 'chat.queue.updated', request.id);
    void this.executeRequest(request);
  }

  async sync(userId: string, conversationId: string): Promise<ChatTurnQueueSnapshot> {
    await this.conversations.assertUserAccess({ userId, conversationId });
    return { ...await this.requests.snapshot(conversationId, this.delivery.currentSequence()), inputs: await Promise.all((await this.agentTurns.inputsForConversation(userId, conversationId)).map((row) => this.projectInput(row, { ...row.turn, userId, conversationId, agentId: row.turn.agentId }))) };
  }

  async publishSnapshot(
    userId: string,
    conversationId: string,
    type: 'chat.queue.snapshot' | 'chat.queue.updated' = 'chat.queue.updated',
    requestId = '',
  ): Promise<ChatTurnQueueSnapshot> {
    const snapshot = await this.requests.snapshot(conversationId, this.delivery.currentSequence());
    this.delivery.publish({
      type, userId, conversationId, requestId: requestId || snapshot.active?.requestId || '',
      traceId: snapshot.active?.traceId ?? null, payload: snapshot,
    });
    return snapshot;
  }

  private async projectInput(row: any, turn: any) {
    const refs: Array<{ objectId: string; position: number }> = Array.isArray(row.objectRefs) ? row.objectRefs : [];
    const cards = await this.objects.inspectCardsByIds({ userId: turn.userId, agentId: turn.agentId, conversationId: turn.conversationId }, refs.map((ref) => ref.objectId));
    return { id: row.id, clientInputId: row.clientInputId, kind: row.kind, content: row.content,
      sequence: row.sequence, createdAt: row.createdAt, userMessageId: turn.userMessageId,
      objects: refs.flatMap((ref) => { const card = cards.get(ref.objectId); return card ? [{ ...card, objectId: ref.objectId, position: ref.position,
        messageId: turn.userMessageId, conversationId: turn.conversationId, role: 'user_input' }] : []; }) };
  }

  async resumeRecoveredRequest(requestId: string, resume: boolean): Promise<boolean> {
    const claimed = await this.requests.claimRecovery(requestId);
    if (!claimed?.traceId || this.executions.currentByTrace(claimed.traceId)) return false;
    void this.executeRequest(claimed, resume);
    return true;
  }

  async resumeWaitingUser(conversationId: string): Promise<void> {
    const active = await this.requests.findActive(conversationId);
    if (!active?.traceId || active.status !== 'WAITING_USER' || this.executions.currentByTrace(active.traceId)) return;
    if (!(await this.agentTurns.pendingInputs(active.traceId)).some((row) => row.kind !== 'CONTEXT_INJECTION')) return;
    const resumed = await this.requests.claimUserResume(active.id);
    if (resumed) void this.executeRequest(resumed, true);
  }

  private async executeRequest(request: any, resume = false): Promise<void> {
    const traceId = String(request.traceId);
    const payload = this.requests.payload(request.payload);
    const execution = this.executions.begin({
      requestId: request.id, traceId, userId: request.userId, agentId: request.agentId,
      conversationId: request.conversationId,
    });
    let reachedTerminal = false;
    let turnAnchors: ChatTurnAnchors | null = null;
    try {
      const result = await this.turns.start({
        traceId,
        resume,
        requestId: request.id,
        userId: request.userId,
        agentId: request.agentId,
        conversationId: request.conversationId,
        content: payload.content,
        clientMessageId: request.clientMessageId,
        model: payload.model,
        objectRefs: payload.objectRefs,
        runtimeOptions: payload.runtimeOptions ?? undefined,
        explicitSkillIds: payload.explicitSkillIds,
        localeContext: payload.localeContext,
        abortSignal: execution.controller.signal,
        onStarted: async (anchors) => {
          turnAnchors = anchors;
          const running = await this.requests.markRunning(
            request.id,
            traceId,
            {
              userMessageId:
                anchors.userMessageId,
              assistantMessageId:
                anchors.assistantMessageId,
            },
          );
          if (!running) throw new Error('CHAT_TURN_START_STATE_CONFLICT');
          this.delivery.publish({
            type: 'chat.turn.started', userId: request.userId, conversationId: request.conversationId,
            requestId: request.id, traceId,
            payload: { ...this.requests.view(running), ...anchors, content: payload.content, objectRefs: payload.objectRefs },
          });
          await this.publishSnapshot(request.userId, request.conversationId, 'chat.queue.updated', request.id);
        },
        onDelta: async (chunk, anchors) => {
          if (execution.controller.signal.aborted) return;
          this.delivery.publish({
            type: 'chat.response.delta', userId: request.userId, conversationId: request.conversationId,
            requestId: request.id, traceId,
            payload: { ...anchors, chunk, is_complete: false },
          });
        },
        onObjects: async (objects, anchors) => {
          this.delivery.publish({
            type: 'chat.turn.objects', userId: request.userId, conversationId: request.conversationId,
            requestId: request.id, traceId,
            payload: { ...anchors, objects, is_complete: false },
          });
        },
      });

      if (result.terminalStatus === 'waiting_approval' || result.terminalStatus === 'waiting_external' || result.terminalStatus === 'waiting_user') {
        await this.requests.markWaiting(
          request.id,
          traceId,
          result.terminalStatus === 'waiting_approval' ? 'WAITING_APPROVAL' : result.terminalStatus === 'waiting_user' ? 'WAITING_USER' : 'WAITING_EXTERNAL',
        );
        await this.publishSnapshot(request.userId, request.conversationId, 'chat.queue.updated', request.id);
        return;
      }

      const status = result.terminalStatus === 'partially_succeeded' ? 'PARTIAL'
        : result.terminalStatus === 'blocked' ? 'BLOCKED'
          : result.terminalStatus === 'cancelled' ? 'CANCELLED'
            : result.terminalStatus === 'failed' ? 'FAILED' : 'SUCCEEDED';
      const terminal = await this.requests.markTerminal({ requestId: request.id, traceId, status });
      if (!terminal) return;
      reachedTerminal = true;
      const type = status === 'CANCELLED' ? 'chat.turn.cancelled'
        : status === 'FAILED' ? 'chat.response.failed' : 'chat.response.completed';
      this.delivery.publish({
        type, userId: request.userId, conversationId: request.conversationId,
        requestId: request.id, traceId,
        payload: {
          ...(turnAnchors ?? {}),
          userMessageId: result.userMessageId, assistantMessageId: result.assistantMessageId,
          content: result.content, citations: result.citations, runtime: result.runtime,
          objects: result.objects, warnings: result.warnings, reasonCodes: result.reasonCodes,
          status, is_complete: true,
        },
      });
    } catch (error) {
      const current = await this.requests.findById(request.id);
      const cancelled = execution.controller.signal.aborted || current?.status === 'CANCELLING';
      const terminal = await this.requests.markTerminal({
        requestId: request.id,
        traceId,
        status: cancelled ? 'CANCELLED' : 'FAILED',
        cleanupStatus: cancelled ? 'CONFIRMED' : 'NOT_REQUIRED',
        failureCode: cancelled ? null : 'CHAT_TURN_UNHANDLED_FAILURE',
        failureMessage: cancelled ? null : error instanceof Error ? error.message : String(error),
      });
      if (terminal) {
        reachedTerminal = true;
        this.delivery.publish({
          type: cancelled ? 'chat.turn.cancelled' : 'chat.response.failed',
          userId: request.userId, conversationId: request.conversationId,
          requestId: request.id, traceId,
          payload: cancelled
            ? {
                ...(turnAnchors ?? {}),
                status: 'CANCELLED',
                reason: 'user_requested',
              }
            : {
                ...(turnAnchors ?? {}),
                status: 'FAILED',
                message: error instanceof Error ? error.message : String(error),
              },
        });
      }
    } finally {
      this.executions.finish(traceId);
      await this.resumeWaitingUser(request.conversationId);
      if (reachedTerminal) this.scheduleDrain(request.conversationId);
      await this.publishSnapshot(request.userId, request.conversationId, 'chat.queue.updated', request.id)
        .catch(() => undefined);
    }
  }
}
