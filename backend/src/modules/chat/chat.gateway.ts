                                           

import { BadRequestException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeClientLocaleSnapshot } from '../localization/locale-normalizer';

import {
  httpSecurityConfig,
  jwtAccessConfig,
} from '../../common/config/security.config';
import { RuntimeFlowTraceLogger } from '../../common/trace/runtime-flow-trace.logger';
import { RuntimeAccessPolicyEvents } from '../approval/runtime-access-policy.events';
import { RuntimeApprovalService } from '../approval/runtime-approval.service';
import { ChatConversationRepository } from './persistence/chat-conversation.repository';
import { RuntimeAssistantTimelineBus } from './runtime-events/runtime-assistant-timeline.bus';
import { WorkflowRealtimeBus } from '../seekmore-workflow/events/workflow-realtime.bus';
import { ChatTurnOrchestratorService } from './turn/chat-turn-orchestrator.service';
import { ChatTurnCancellationService } from './turn/chat-turn-cancellation.service';
import { ChatTurnDeliveryBus } from './turn/chat-turn-delivery.bus';
import { AutomationRealtimeBus } from '../automation/automation-realtime.bus';
import {
  WS_CHAT_TITLE_CREATED,
  WS_CHAT_TITLE_UPDATED,
} from './types/chat.events';

const WS_BACKPRESSURE_DISCONNECT_BYTES = 1_048_576;

type ChatIncomingObjectRef = {
  objectId?: string;
  position?: number;
};

type ChatIncomingPayload = {
  content: string;
  agentId: string;
  conversationId: string;
  id?: string | null;
  model?: string | null;
  objectRefs?: ChatIncomingObjectRef[];
  explicitSkillIds?: string[];
  runtimeOptions?: {
    enabledCapabilityKinds?: string[];
    enabledToolNames?: string[];
    toolDecisionMaxIterations?: number;
    workspaceId?: string | null;
    permissionMode?:
      | 'confirm_required'
      | 'audit_autorun'
      | 'full_access';
    approvalId?: string | null;
    approvalDecision?:
      | 'approved_once'
      | 'audit_only'
      | 'full_access_for_task'
      | 'rejected'
      | null;
  };
};

@Injectable()
@WebSocketGateway({
  cors: {
    origin: httpSecurityConfig().allowedOrigins,
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'x-request-id',
    ],
  },
  pingInterval: 25_000,
  pingTimeout: 20_000,
})
export class ChatGateway
  implements
    OnGatewayDisconnect,
    OnGatewayConnection,
    OnGatewayInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private runtimeEventsSub?: Subscription;
  private accessPolicyEventsSub?: Subscription;
  private workflowEventsSub?: Subscription;
  private turnDeliverySub?: Subscription;
  private automationEventsSub?: Subscription;
  private readonly authExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly trace: RuntimeFlowTraceLogger,
    private readonly runtimeTimeline: RuntimeAssistantTimelineBus,
    private readonly workflowRealtime: WorkflowRealtimeBus,
    private readonly approvals: RuntimeApprovalService,
    private readonly accessPolicyEvents: RuntimeAccessPolicyEvents,
    private readonly conversations: ChatConversationRepository,
    private readonly prisma: PrismaService,
    private readonly turnOrchestrator: ChatTurnOrchestratorService,
    private readonly turnCancellation: ChatTurnCancellationService,
    private readonly turnDelivery: ChatTurnDeliveryBus,
    private readonly automationRealtime: AutomationRealtimeBus,
  ) {}

  afterInit(server: Server): void {
    server.use(async (client: Socket, next) => {
      const authFromAuth = String(
        client.handshake?.auth?.Authorization ?? '',
      );

      const authFromHeader = String(
        client.handshake?.headers?.authorization ?? '',
      );

      const raw = authFromAuth || authFromHeader;

      if (!raw) {
        return next(new Error('UNAUTHORIZED'));
      }

      const token = raw.startsWith('Bearer ')
        ? raw.slice(7)
        : raw;

      if (!token) {
        return next(new Error('UNAUTHORIZED'));
      }

      try {
        const jwt = jwtAccessConfig();

        const payload: any = this.jwtService.verify(token, {
          secret: jwt.secret,
          issuer: jwt.issuer,
          audience: jwt.audience,
        });

        if (payload?.typ !== 'access') {
          return next(new Error('UNAUTHORIZED'));
        }

        const userId = String(
          payload?.sub ??
            payload?.uid ??
            payload?.id ??
            '',
        ).trim();

        if (!userId) {
          return next(new Error('UNAUTHORIZED'));
        }
        const sessionId = String(payload?.sid ?? '').trim();
        if (!sessionId) return next(new Error('UNAUTHORIZED'));

        const account = await this.prisma.localAccount.findFirst({
          where: {
            key: 'primary',
            userId,
            sessionId,
            user: { isActive: true, deletedAt: null },
          },
          select: { userId: true },
        });
        if (!account) return next(new Error('UNAUTHORIZED'));

        client.data.userId = userId;
        client.data.jwt = payload;

        return next();
      } catch {
        return next(new Error('UNAUTHORIZED'));
      }
    });

    this.bindRuntimeEvents();
    this.bindAccessPolicyEvents();
    this.bindWorkflowEvents();
    this.bindTurnDelivery();
    this.bindAutomationEvents();

    this.logger.log(
      '[ChatWS] afterInit: JWT guard mounted; runtime and workflow event bindings enabled',
    );

    this.trace.event('gateway.after_init', {
      jwtGuard: true,
      runtimeObjectBinding: true,
      workflowBinding: true,
    });
  }

  onModuleDestroy(): void {
    try {
      this.runtimeEventsSub?.unsubscribe();
      this.accessPolicyEventsSub?.unsubscribe();
      this.workflowEventsSub?.unsubscribe();
      this.turnDeliverySub?.unsubscribe();
      this.automationEventsSub?.unsubscribe();
    } catch {
             
    }
    for (const timer of this.authExpiryTimers.values()) clearTimeout(timer);
    this.authExpiryTimers.clear();
  }


  private bindAutomationEvents(): void {
    if (this.automationEventsSub) return;
    this.automationEventsSub = this.automationRealtime.events$.subscribe((event) => {
      if (!this.server || !event.userId || !event.conversationId) return;
      this.emitToUser(event.userId, event.type, {
        conversationId: event.conversationId,
        ...event.payload,
      });
    });
  }

  private bindTurnDelivery(): void {
    if (this.turnDeliverySub) return;
    this.turnDeliverySub = this.turnDelivery.events$.subscribe((event) => {
      const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown>
        : { value: event.payload };
      this.emitToUser(event.userId, event.type, { ...event, ...payload });
    });
  }

  private bindWorkflowEvents(): void {
    if (this.workflowEventsSub) return;

    this.workflowEventsSub = this.workflowRealtime.events$.subscribe((event) => {
      if (!this.server || !event.userId || !event.conversationId) return;

      this.trace.event('gateway.workflow_event_emit', {
        trace: event.traceId,
        userId: event.userId,
        agentId: event.agentId,
        conversationId: event.conversationId,
        workflowId: event.workflowId,
        reason: event.reason,
        status: event.status,
        runVersion: event.runVersion,
        phaseCount: event.phaseCount,
        currentPhaseId: event.currentPhase?.id ?? null,
        phases: JSON.stringify(
          event.phases.map((phase) => ({
            id: phase.id,
            parentPhaseId: phase.parentPhaseId,
            title: phase.title,
            status: phase.status,
            position: phase.position,
          })),
        ),
      });

      this.emitToUser(event.userId, event.type, event);
    });
  }

  private bindAccessPolicyEvents(): void {
    if (this.accessPolicyEventsSub) return;
    this.accessPolicyEventsSub = this.accessPolicyEvents.events$.subscribe((event) => {
      if (!this.server || !event.userId || !event.conversationId) return;
      this.emitToUser(event.userId, 'runtime_settings_updated', event);
    });
  }

  private bindRuntimeEvents(): void {
    if (this.runtimeEventsSub) {
      return;
    }

    this.runtimeEventsSub =
      this.runtimeTimeline.events$.subscribe((event) => {
        if (!this.server || !event.conversationId) {
          return;
        }

        if (event.type === 'assistant.timeline.activity') {
          this.trace.event('gateway.runtime_event_emit', {
            trace: event.traceId,
            conversationId: event.conversationId,
            assistantMessageId: event.assistantMessageId,
            eventType: event.type,
            activityId: event.activity.activityId,
            kind: event.activity.kind,
            status: event.activity.status,
            operation: event.activity.operation,
            sequence: event.sequence,
            userScoped: Boolean(event.userId),
          });
        } else if (
          event.type === 'assistant.timeline.content' &&
          event.block.final
        ) {
          this.trace.event('gateway.runtime_event_emit', {
            trace: event.traceId,
            conversationId: event.conversationId,
            assistantMessageId: event.assistantMessageId,
            eventType: event.type,
            blockId: event.block.blockId,
            role: event.block.role,
            final: event.block.final,
            sequence: event.sequence,
            userScoped: Boolean(event.userId),
          });
        }

        if (event.userId) {
          this.emitToUser(
            event.userId,
            'runtime_event',
            event,
          );

          return;
        }

        this.server
          .to(`conversation:${event.conversationId}`)
          .emit('runtime_event', event);
      });
  }

  handleConnection(client: Socket): void {
    const userId =
      client.data?.userId as string | undefined;

    if (userId) {
      client.join(`user:${userId}`);

      const expiresAtMs = Number(client.data?.jwt?.exp ?? 0) * 1000;
      const delayMs = expiresAtMs - Date.now();
      if (delayMs <= 0) {
        client.disconnect(true);
        return;
      }
      const timer = setTimeout(() => {
        this.trace.event(
          'gateway.auth_expired_disconnect',
          {
            socketId: client.id,
            userId,
            expiresAtMs,
          },
        );
        client.emit('auth_expired');
        client.disconnect(true);
      }, delayMs);
      this.authExpiryTimers.set(client.id, timer);

      void this.approvals
        .replayActiveForUser(userId)
        .then((count) => {
          this.trace.event(
            'gateway.approval_replay_done',
            {
              socketId: client.id,
              userId,
              replayed: count,
            },
          );
        })
        .catch((error) => {
          this.trace.warn(
            'gateway.approval_replay_failed',
            {
              socketId: client.id,
              userId,
              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
          );
        });
    }

    client.once(
      'disconnect',
      (reason) => {
        this.trace.event(
          'gateway.disconnect_reason',
          {
            socketId: client.id,
            userId:
              client.data?.userId
              ?? null,
            reason,
            transport:
              client.conn?.transport
                ?.name
              ?? null,
          },
        );
      },
    );

    this.logger.log(
      `✅ Client connected: ${client.id}, user=${
        userId ?? '-'
      }`,
    );

    this.trace.event('gateway.connected', {
      socketId: client.id,
      userId: userId ?? null,
      joinedUserRoom: Boolean(userId),
    });
  }

  handleDisconnect(client: Socket): void {
    const timer = this.authExpiryTimers.get(client.id);
    if (timer) clearTimeout(timer);
    this.authExpiryTimers.delete(client.id);
    this.logger.log(
      `❌ Client disconnected: ${client.id}, user=${
        client.data?.userId ?? '-'
      }`,
    );

    this.trace.event('gateway.disconnected', {
      socketId: client.id,
      userId: client.data?.userId ?? null,
    });
  }

  public emitToUser(
    userId: string,
    event: string,
    payload: unknown,
  ): void {
    if (!this.server) {
      return;
    }

    const record = this.asRecord(payload);

    this.trace.debug('gateway.emit_to_user', {
      userId,
      event,
      trace: this.normalizeTraceString(
        record.traceId ?? record.trace,
      ),
      conversationId: this.normalizeTraceString(
        record.conversationId,
      ),
      payloadKeys: Object.keys(record).join(','),
    });

    const room =
      this.server.sockets.adapter.rooms.get(
        `user:${userId}`,
      );

    if (room) {
      for (const socketId of room) {
        const socket =
          this.server.sockets.sockets.get(socketId);

        const writableLength = Number(
          (socket as any)?.conn?.transport
            ?.writableLength ?? 0,
        );

        if (
          writableLength >
          WS_BACKPRESSURE_DISCONNECT_BYTES
        ) {
          this.trace.warn(
            'gateway.slow_client_disconnected',
            {
              userId,
              socketId,
              event,
              writableLength,
            },
          );

          socket?.disconnect(true);
        }
      }
    }

    this.server
      .to(`user:${userId}`)
      .emit(event, payload);
  }

  public emitTitleCreated(
    userId: string,
    payload: unknown,
  ): void {
    this.emitToUser(
      userId,
      WS_CHAT_TITLE_CREATED,
      payload,
    );
  }

  public emitTitleUpdated(
    userId: string,
    payload: unknown,
  ): void {
    this.emitToUser(
      userId,
      WS_CHAT_TITLE_UPDATED,
      payload,
    );
  }

  @SubscribeMessage('join_user_room')
  handleJoinUserRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      userId?: string;
    },
  ) {
    const authedUserId =
      client.data?.userId as string | undefined;

    this.trace.event('gateway.join_user_room', {
      socketId: client.id,
      authedUserId: authedUserId ?? null,
      requestedUserId: data?.userId ?? null,
      accepted: Boolean(
        authedUserId &&
          (!data?.userId ||
            data.userId === authedUserId),
      ),
    });

    if (!authedUserId) {
      return {
        ok: false,
        error: 'UNAUTHORIZED',
      };
    }

    if (
      data?.userId &&
      data.userId !== authedUserId
    ) {
      return {
        ok: false,
        error: 'USER_MISMATCH',
      };
    }

    client.join(`user:${authedUserId}`);

    return {
      ok: true,
      userId: authedUserId,
    };
  }

  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      conversationId?: string;
    },
  ) {
    const userId = String(
      client.data?.userId ?? '',
    ).trim();

    const conversationId = String(
      data?.conversationId ?? '',
    ).trim();

    if (!userId || !conversationId) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
      };
    }

    try {
      await this.conversations.assertUserAccess({
        userId,
        conversationId,
      });

      await client.join(
        `conversation:${conversationId}`,
      );

      this.trace.event(
        'gateway.join_conversation',
        {
          socketId: client.id,
          userId,
          conversationId,
          accepted: true,
        },
      );

      return {
        ok: true,
        conversationId,
      };
    } catch {
      this.trace.warn(
        'gateway.join_conversation_denied',
        {
          socketId: client.id,
          userId,
          conversationId,
        },
      );

      return {
        ok: false,
        error: 'CONVERSATION_ACCESS_DENIED',
      };
    }
  }

  @SubscribeMessage('runtime.approval_approved')
  async handleApprovalApproved(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      approvalId?: string;
      decision?:
        | 'approved_once'
        | 'audit_only'
        | 'full_access_for_task';
      taskRunId?: string | null;
    },
  ) {
    const userId = String(
      client.data?.userId ?? '',
    ).trim();

    const approvalId = String(
      payload?.approvalId ?? '',
    ).trim();

    const decision =
      payload?.decision ?? 'approved_once';

    this.trace.event(
      'gateway.approval_approved_received',
      {
        socketId: client.id,
        userId: userId || null,
        approvalId: approvalId || null,
        decision,
      },
    );

    if (!userId) {
      this.trace.warn(
        'gateway.approval_decide_failed',
        {
          socketId: client.id,
          approvalId: approvalId || null,
          reason: 'UNAUTHORIZED',
        },
      );

      return {
        ok: false,
        error: 'UNAUTHORIZED',
      };
    }

    try {
      const result = await this.approvals.decide({
        approvalId,
        userId,
        decision,
        taskRunId: payload?.taskRunId ?? null,
      });

      this.trace.event(
        'gateway.approval_decide_done',
        {
          socketId: client.id,
          userId,
          approvalId: approvalId || null,
          decision,
          found: Boolean(result),
          status: result?.status ?? null,
          permissionMode:
            result?.permissionMode ?? null,
          resumedAt: result?.resumedAt ?? null,
          resumeError:
            result?.resumeError ?? null,
        },
      );

      return result
        ? {
            ok: true,
            approvalId: result.approvalId,
            status: result.status,
            permissionMode:
              result.permissionMode,
            resumedAt:
              result.resumedAt ?? null,
            resumeError:
              result.resumeError ?? null,
          }
        : {
            ok: false,
            error: 'APPROVAL_NOT_FOUND',
          };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'approval decide failed';

      this.trace.warn(
        'gateway.approval_decide_failed',
        {
          socketId: client.id,
          userId,
          approvalId: approvalId || null,
          decision,
          message,
        },
      );

      return {
        ok: false,
        error: 'APPROVAL_DECIDE_FAILED',
        message,
      };
    }
  }

  @SubscribeMessage('runtime.approval_rejected')
  async handleApprovalRejected(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      approvalId?: string;
      taskRunId?: string | null;
    },
  ) {
    const userId = String(
      client.data?.userId ?? '',
    ).trim();

    const approvalId = String(
      payload?.approvalId ?? '',
    ).trim();

    this.trace.event(
      'gateway.approval_rejected_received',
      {
        socketId: client.id,
        userId: userId || null,
        approvalId: approvalId || null,
      },
    );

    if (!userId) {
      this.trace.warn(
        'gateway.approval_decide_failed',
        {
          socketId: client.id,
          approvalId: approvalId || null,
          reason: 'UNAUTHORIZED',
        },
      );

      return {
        ok: false,
        error: 'UNAUTHORIZED',
      };
    }

    try {
      const result = await this.approvals.decide({
        approvalId,
        userId,
        decision: 'rejected',
        taskRunId: payload?.taskRunId ?? null,
      });

      this.trace.event(
        'gateway.approval_decide_done',
        {
          socketId: client.id,
          userId,
          approvalId: approvalId || null,
          decision: 'rejected',
          found: Boolean(result),
          status: result?.status ?? null,
        },
      );

      return result
        ? {
            ok: true,
            approvalId: result.approvalId,
            status: result.status,
            permissionMode:
              result.permissionMode,
            resumedAt:
              result.resumedAt ?? null,
            resumeError:
              result.resumeError ?? null,
          }
        : {
            ok: false,
            error: 'APPROVAL_NOT_FOUND',
          };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'approval decide failed';

      this.trace.warn(
        'gateway.approval_decide_failed',
        {
          socketId: client.id,
          userId,
          approvalId: approvalId || null,
          decision: 'rejected',
          message,
        },
      );

      return {
        ok: false,
        error: 'APPROVAL_DECIDE_FAILED',
        message,
      };
    }
  }

  @SubscribeMessage('chat.turn.submit')
  async submitTurn(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ChatIncomingPayload & { clientMessageId?: string; expectedTraceId?: string; localeContext?: unknown },
  ) {
    const userId = String(client.data?.userId ?? '').trim();
    if (!userId) return { ok: false, code: 'ACCESS_DENIED', message: 'ACCESS_DENIED' };
    try {
      return await this.turnOrchestrator.submit({
        userId,
        expectedTraceId: payload.expectedTraceId,
        clientMessageId: String(payload?.clientMessageId ?? payload?.id ?? '').trim(),
        conversationId: String(payload?.conversationId ?? '').trim(),
        agentId: String(payload?.agentId ?? '').trim(),
        content: String(payload?.content ?? ''),
        objectRefs: this.normalizeObjectRefs(payload),
        model: payload?.model ?? null,
        runtimeOptions: payload?.runtimeOptions ?? null,
        explicitSkillIds: Array.isArray(payload?.explicitSkillIds) ? payload.explicitSkillIds : [],
        localeContext: normalizeClientLocaleSnapshot(payload?.localeContext),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        code: this.submitErrorCode(message),
        message,
      };
    }
  }

  @SubscribeMessage('chat.turn.stop')
  async stopTurn(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string; expectedTraceId?: string; expectedRequestId?: string; reason?: string },
  ) {
    const userId = String(client.data?.userId ?? '').trim();
    if (!userId) return { ok: false, code: 'ACCESS_DENIED', message: 'ACCESS_DENIED' };
    const conversationId = String(payload?.conversationId ?? '').trim();
    const expectedTraceId = String(payload?.expectedTraceId ?? '').trim();
    const expectedRequestId = String(payload?.expectedRequestId ?? '').trim();
    if (!conversationId || (!expectedTraceId && !expectedRequestId) || payload?.reason !== 'user_requested') {
      return { ok: false, code: 'INVALID_REQUEST', message: 'INVALID_REQUEST' };
    }
    return this.turnCancellation.stopActiveTurn({ userId, conversationId, expectedTraceId: expectedTraceId || undefined,
      expectedRequestId: expectedRequestId || undefined, reason: 'user_requested' });
  }

  @SubscribeMessage('chat.turn.sync')
  async syncTurn(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string },
  ) {
    const userId = String(client.data?.userId ?? '').trim();
    const conversationId = String(payload?.conversationId ?? '').trim();
    if (!userId || !conversationId) return { ok: false, code: 'INVALID_REQUEST', message: 'INVALID_REQUEST' };
    try {
      const snapshot = await this.turnOrchestrator.sync(userId, conversationId);
      this.turnDelivery.publish({
        type: 'chat.queue.snapshot', userId, conversationId,
        requestId: snapshot.active?.requestId ?? '', traceId: snapshot.active?.traceId ?? null, payload: snapshot,
      });
      return { ok: true, snapshot };
    } catch (error) {
      return { ok: false, code: 'ACCESS_DENIED', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private normalizeObjectRefs(
    payload: ChatIncomingPayload,
  ): Array<{
    objectId: string;
    position: number;
  }> {
    const out: Array<{
      objectId: string;
      position: number;
    }> = [];

    const seenObjectIds = new Set<string>();
    const seenPositions = new Set<number>();

    for (const item of payload.objectRefs ?? []) {
      const objectId = String(
        item?.objectId ?? '',
      ).trim();

      const position = Number(item?.position);

      if (!objectId) {
        throw new BadRequestException('OBJECT_REFERENCE_INVALID');
      }
      if (seenObjectIds.has(objectId)) {
        throw new BadRequestException({ code: 'OBJECT_REFERENCE_DUPLICATE', message: 'OBJECT_REFERENCE_DUPLICATE', params: { objectId } });
      }
      if (!Number.isInteger(position) || position < 0) {
        throw new BadRequestException({ code: 'OBJECT_POSITION_INVALID', message: 'OBJECT_POSITION_INVALID', params: { objectId } });
      }
      if (seenPositions.has(position)) {
        throw new BadRequestException({ code: 'OBJECT_POSITION_DUPLICATE', message: 'OBJECT_POSITION_DUPLICATE', params: { position } });
      }

      seenObjectIds.add(objectId);
      seenPositions.add(position);
      out.push({ objectId, position });
    }

    out.sort((left, right) =>
      left.position - right.position,
    );

    this.trace.debug(
      'gateway.object_refs_normalized',
      {
        inputCount: payload.objectRefs?.length ?? 0,
        normalizedCount: out.length,
        objectIds: out
          .map((item) => item.objectId)
          .join(','),
      },
    );

    return out;
  }

  private submitErrorCode(message: string): string {
    const normalized = message.trim();
    if (
      normalized === 'USER_LLM_SETTINGS_REQUIRED'
      || normalized === 'LLM_API_KEY_REQUIRED'
      || normalized === 'CONVERSATION_RECYCLED'
    ) {
      return normalized;
    }
    const objectCode = normalized.split(':', 1)[0];
    if (
      objectCode === 'OBJECT_NOT_READY'
      || objectCode === 'OBJECT_REFERENCE_INVALID'
      || objectCode === 'OBJECT_REFERENCE_DUPLICATE'
      || objectCode === 'OBJECT_POSITION_INVALID'
      || objectCode === 'OBJECT_POSITION_DUPLICATE'
    ) {
      return objectCode;
    }
    return 'INVALID_REQUEST';
  }

  private asRecord(
    value: unknown,
  ): Record<string, unknown> {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private normalizeTraceString(
    value: unknown,
  ): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();

    return normalized || null;
  }
}
