import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import type {
  AgentRuntimeTurnRequest,
  AgentTurnExecutionResult,
} from '../contracts/agent-turn.types';

@Injectable()
export class AgentTurnRepository {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async start(request: AgentRuntimeTurnRequest) {
    return (this.prisma as any).agentTurn.upsert({
      where: {
        traceId: request.traceId,
      },

      create: {
        traceId: request.traceId,
        userId: request.userId,
        agentId: request.agentId,
        conversationId: request.conversationId,
        userMessageId: request.userMessageId,
        assistantMessageId: request.assistantMessageId,

                                    
                                                         
        kernelSessionId: request.conversationId,

        status: 'running',
        workspaceId: request.workspace.workspaceId,
        permissionMode: request.permissionMode,
        accessPolicyVersion: Math.max(1, Number(request.accessPolicyVersion ?? 1)),
        requestJson:
          this.persistedRequest(request),
      },

      update: {
        status: 'running',

        kernelSessionId: request.conversationId,
        workspaceId: request.workspace.workspaceId,
        permissionMode: request.permissionMode,
        accessPolicyVersion: Math.max(1, Number(request.accessPolicyVersion ?? 1)),

        requestJson:
          this.persistedRequest(request),

        resultJson: Prisma.JsonNull,
        errorJson: Prisma.JsonNull,
        completedAt: null,
      },
    });
  }

  async updateRequest(
    traceId: string,
    request: AgentRuntimeTurnRequest,
  ): Promise<void> {
    await (this.prisma as any).agentTurn.update({
      where: { traceId },
      data: {
        workspaceId: request.workspace.workspaceId,
        permissionMode: request.permissionMode,
        accessPolicyVersion: Math.max(1, Number(request.accessPolicyVersion ?? 1)),
        requestJson:
          this.persistedRequest(request),
      },
    });
  }

  async complete(
    traceId: string,
    result: AgentTurnExecutionResult,
  ): Promise<void> {
    const status =
      result.outcome.kind === 'paused'
        ? `waiting_${result.outcome.reason}`
        : result.outcome.status;
    const completedAt = result.outcome.kind === 'paused' ? null : new Date();

    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockTurn(tx, traceId);
      if (current.completedAt) return;
      const turn = await tx.agentTurn.update({
        where: { traceId },
        data: {
          status,
          resultJson: result as unknown as Prisma.InputJsonValue,
          completedAt,
        },
      });

      if (completedAt && !this.isGrowFocusRequest(turn.requestJson)) {
        await this.writeTerminalOutbox(tx, turn, status, completedAt);
      }
    });
  }

  async fail(
    traceId: string,
    error: unknown,
  ): Promise<void> {
    const completedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_turn" WHERE "trace_id" = ${traceId} FOR UPDATE`);
      const turn = await tx.agentTurn.findUnique({ where: { traceId } });
      if (!turn || turn.completedAt) return;

      const updated = await tx.agentTurn.update({
        where: { traceId },
        data: {
          status: 'failed',
          errorJson: {
            message:
              error instanceof Error
                ? error.message
                : String(error),
          },
          completedAt,
        },
      });

      if (!this.isGrowFocusRequest(updated.requestJson)) {
        await this.writeTerminalOutbox(tx, updated, 'failed', completedAt);
      }
    });
  }

  async cancel(traceId: string, reason: unknown): Promise<void> {
    const completedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_turn" WHERE "trace_id" = ${traceId} FOR UPDATE`);
      const turn = await tx.agentTurn.findFirst({
        where: {
          traceId,
          status: {
            notIn: ['succeeded', 'partial', 'failed', 'blocked', 'cancelled'],
          },
        },
      });
      if (!turn) return;

      const updated = await tx.agentTurn.update({
        where: { id: turn.id },
        data: {
          status: 'cancelled',
          errorJson: {
            message: reason == null ? 'cancelled' : String(reason),
          },
          completedAt,
        },
      });

      if (!this.isGrowFocusRequest(updated.requestJson)) {
        await this.writeTerminalOutbox(tx, updated, 'cancelled', completedAt);
      }
    });
  }

  findByTrace(traceId: string) {
    return this.prisma.agentTurn.findUnique({
      where: {
        traceId,
      },
    });
  }

  private persistedRequest(request: AgentRuntimeTurnRequest): Prisma.InputJsonValue {
    const { apiKey: _apiKey, headers: _headers, fallbacks, ...agent } = request.agent;
    return JSON.parse(JSON.stringify({ ...request, agent: { ...agent,
      fallbacks: fallbacks?.map(({ apiKey: _key, headers: _routeHeaders, ...route }) => route),
    } }));
  }

  /** Serialize input acceptance, consumption and terminal sealing on the Turn. */
  private async lockTurn(tx: Prisma.TransactionClient, traceId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_turn" WHERE "trace_id" = ${traceId} FOR UPDATE`);
    return tx.agentTurn.findUniqueOrThrow({ where: { traceId } });
  }

  async appendInput(input: {
    traceId: string; userId: string; conversationId: string; clientInputId: string;
    content: string; objectRefs: Array<{ objectId: string; position: number }>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const turn = await this.lockTurn(tx, input.traceId);
      if (turn.userId !== input.userId || turn.conversationId !== input.conversationId) throw new Error('TURN_INPUT_ACCESS_DENIED');
      const existing = await tx.agentTurnInput.findUnique({ where: { turnId_clientInputId: { turnId: turn.id, clientInputId: input.clientInputId } } });
      if (existing) return { turn, input: existing };
      const admission = await tx.chatTurnRequest.findFirst({ where: { traceId: input.traceId } });
      if (admission?.status === 'CANCELLING' || admission?.status === 'CANCELLED') throw new Error('TURN_NO_LONGER_ACCEPTS_INPUT');
      if (!['running', 'waiting_user_input', 'waiting_approval', 'waiting_external_dependency'].includes(turn.status)) throw new Error('TURN_NO_LONGER_ACCEPTS_INPUT');
      const max = await tx.agentTurnInput.aggregate({ where: { turnId: turn.id }, _max: { sequence: true } });
      const row = await tx.agentTurnInput.create({ data: {
        turnId: turn.id, clientInputId: input.clientInputId, sequence: (max._max.sequence ?? 0) + 1,
        kind: turn.status === 'waiting_user_input' ? 'USER_RESPONSE' : 'STEERING',
        content: input.content, objectRefs: input.objectRefs,
      } });
      return { turn, input: row };
    });
  }

  async inputsForConversation(userId: string, conversationId: string) {
    return this.prisma.agentTurnInput.findMany({
      where: { turn: { userId, conversationId }, kind: { in: ['STEERING', 'USER_RESPONSE'] } },
      include: { turn: { select: { userMessageId: true, traceId: true, agentId: true } } },
      orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }],
    });
  }

  async pendingInputs(traceId: string) {
    return this.prisma.agentTurnInput.findMany({ where: { turn: { traceId }, consumedAt: null }, orderBy: { sequence: 'asc' } });
  }

  async resolveInputObjects(
    traceId: string,
    refs: Array<{ objectId: string; position: number }>,
  ) {
    if (refs.length === 0) return [];
    const turn = await this.findByTrace(traceId);
    if (!turn) throw new Error('TURN_NOT_FOUND');
    const ids = [...new Set(refs.map((ref) => String(ref.objectId ?? '').trim()).filter(Boolean))];
    const rows = await this.prisma.runtimeObject.findMany({
      where: {
        id: { in: ids },
        userId: turn.userId,
        agentId: turn.agentId,
        conversationId: turn.conversationId,
        visibility: 'user_visible',
        status: 'available',
        deletedAt: null,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return refs
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((ref) => ({ ref, object: byId.get(ref.objectId) ?? null }));
  }

  async journal(traceId: string, kind: string, iteration: number, payload: unknown) {
    return this.prisma.$transaction(async (tx) => {
      const turn = await this.lockTurn(tx, traceId);
      return this.appendEvent(tx, turn.id, kind, iteration, payload);
    });
  }

  private async appendEvent(tx: Prisma.TransactionClient, turnId: string, kind: string, iteration: number, payload: unknown) {
    const max = await tx.agentTurnEvent.aggregate({ where: { turnId }, _max: { sequence: true } });
    return tx.agentTurnEvent.create({ data: {
      turnId, kind, iteration, sequence: (max._max.sequence ?? 0) + 1,
      payloadJson: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
    } });
  }

  /** Consumption and the recoverable canonical trajectory commit atomically. */
  async checkpoint(traceId: string, state: Record<string, unknown>, consumedIds: string[] = []) {
    return this.prisma.$transaction(async (tx) => {
      const turn = await this.lockTurn(tx, traceId);
      for (const id of consumedIds) {
        const changed = await tx.agentTurnInput.updateMany({ where: { id, turnId: turn.id, consumedAt: null }, data: { consumedAt: new Date() } });
        if (changed.count) await this.appendEvent(tx, turn.id, 'input.consumed', Number(state.iteration ?? 0), { inputId: id });
      }
      await tx.agentTurnCheckpoint.upsert({ where: { id: `trajectory:${turn.id}` }, create: { id: `trajectory:${turn.id}`, turnId: turn.id, stateJson: JSON.parse(JSON.stringify(state)) }, update: { stateJson: JSON.parse(JSON.stringify(state)) } });
      if (state.phase === 'waiting_user' && !turn.completedAt) await tx.agentTurn.update({ where: { id: turn.id }, data: { status: 'waiting_user_input' } });
    });
  }

  async restore(traceId: string): Promise<Record<string, any> | null> {
    const turn = await this.findByTrace(traceId);
    if (!turn) return null;
    const checkpoint = await this.prisma.agentTurnCheckpoint.findUnique({ where: { id: `trajectory:${turn.id}` } });
    const state = checkpoint?.stateJson as Record<string, any> | undefined;
    if (!state?.messages) return null;
    if (!['ready', 'waiting_user'].includes(String(state.phase))) throw new Error('TURN_RESUME_REQUIRES_SAFE_BOUNDARY');
    return state;
  }

  async latestCheckpointPhase(traceId: string): Promise<string | null> {
    const turn = await this.findByTrace(traceId);
    if (!turn) return null;
    const checkpoint = await this.prisma.agentTurnCheckpoint.findUnique({
      where: { id: `trajectory:${turn.id}` },
      select: { stateJson: true },
    });
    const state = checkpoint?.stateJson as Record<string, unknown> | undefined;
    return typeof state?.phase === 'string' ? state.phase : null;
  }

  async sealInputs(traceId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const turn = await this.lockTurn(tx, traceId);
      if (turn.completedAt) return false;
      if (await tx.agentTurnInput.count({ where: { turnId: turn.id, consumedAt: null } })) return false;
      await tx.agentTurn.update({ where: { id: turn.id }, data: { status: 'completing' } });
      return true;
    });
  }

  async writeTerminalOutbox(
    tx: Prisma.TransactionClient,
    turn: {
      id: string;
      traceId: string;
      userId: string;
      agentId: string;
      conversationId: string;
    },
    status: string,
    completedAt: Date,
  ): Promise<void> {
    const deduplicationKey = `grow:agent-turn:${turn.id}:${status}`;
    await tx.runtimeEventOutbox.upsert({
      where: { deduplicationKey },
      create: {
        eventId: randomUUID(),
        eventType: 'agent.turn.terminal',
        aggregateType: 'agent_turn',
        aggregateId: turn.id,
        payloadJson: {
          turnId: turn.id,
          traceId: turn.traceId,
          userId: turn.userId,
          agentId: turn.agentId,
          conversationId: turn.conversationId,
          status,
          occurredAt: completedAt.toISOString(),
        },
        deduplicationKey,
        status: 'pending',
        availableAt: new Date(),
      },
      update: {},
    });
  }

  private isGrowFocusRequest(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const executionContext = (value as Record<string, unknown>).executionContext;
    return Boolean(
      executionContext &&
      typeof executionContext === 'object' &&
      !Array.isArray(executionContext) &&
      (executionContext as Record<string, unknown>).kind === 'grow_focus',
    );
  }
}
