                                                             

import { Injectable } from '@nestjs/common';
import type { ToolObserver } from '../toolstypes';
import { RuntimeEventBus } from '../../modules/chat/runtime-events/runtime-event.bus';

interface RuntimeToolObserverContext {
  userId?: string;
  conversationId?: string;
  traceId?: string;
  requestId?: string;
  idempotencyKey?: string;
}

interface RuntimeToolStartEvent {
  tool: string;
  version?: string;
  argsPreview: string;
  ctx?: RuntimeToolObserverContext;
  ts?: number;
}

interface RuntimeToolSuccessEvent {
  tool: string;
  version?: string;
  duration_ms: number;
  ctx?: RuntimeToolObserverContext;
  ts?: number;
}

interface RuntimeToolErrorEvent {
  tool: string;
  version?: string;
  duration_ms: number;
  error?: {
    code?: string;
    message?: string;
  };
  ctx?: RuntimeToolObserverContext;
  ts?: number;
}

@Injectable()
export class RuntimeEventToolObserver implements ToolObserver {
  constructor(private readonly bus: RuntimeEventBus) {}

  onStart(e: RuntimeToolStartEvent): void {
    const ctx = this.normalizeContext(e.ctx);
    if (!ctx) return;

    this.bus.publish({
      type: 'tool.started',
      stage: 'tool',
      status: 'started',
      source: 'tools',
      title: `Tool: ${e.tool}`,
      message: `Starting ${e.tool}`,
      scope: { userId: ctx.userId, conversationId: ctx.conversationId, requestId: ctx.requestId },
      refs: { traceId: ctx.traceId ?? null },
      payload: {
        tool: e.tool,
        version: e.version ?? null,
        argsPreview: e.argsPreview,
        traceId: ctx.traceId ?? null,
        idempotencyKey: ctx.idempotencyKey ?? null,
      },
    });
  }

  onSuccess(e: RuntimeToolSuccessEvent): void {
    const ctx = this.normalizeContext(e.ctx);
    if (!ctx) return;

    this.bus.publish({
      type: 'tool.completed',
      stage: 'tool',
      status: 'succeeded',
      source: 'tools',
      title: `Tool done: ${e.tool}`,
      message: `Completed in ${e.duration_ms}ms`,
      scope: { userId: ctx.userId, conversationId: ctx.conversationId, requestId: ctx.requestId },
      refs: { traceId: ctx.traceId ?? null },
      durationMs: e.duration_ms,
      payload: {
        tool: e.tool,
        version: e.version ?? null,
        duration_ms: e.duration_ms,
        traceId: ctx.traceId ?? null,
      },
    });
  }

  onError(e: RuntimeToolErrorEvent): void {
    const ctx = this.normalizeContext(e.ctx);
    if (!ctx) return;

    const code = e.error?.code ?? 'ERROR';
    const message = e.error?.message ?? 'unknown';

    this.bus.publish({
      type: 'tool.failed',
      stage: 'tool',
      status: 'failed',
      level: 'error',
      source: 'tools',
      title: `Tool error: ${e.tool}`,
      message: `${code}: ${message}`,
      scope: { userId: ctx.userId, conversationId: ctx.conversationId, requestId: ctx.requestId },
      refs: { traceId: ctx.traceId ?? null },
      durationMs: e.duration_ms,
      reasonCodes: [code],
      payload: {
        tool: e.tool,
        version: e.version ?? null,
        duration_ms: e.duration_ms,
        error: {
          code,
          message,
        },
        traceId: ctx.traceId ?? null,
      },
    });
  }

  private normalizeContext(
    ctx?: RuntimeToolObserverContext,
  ): Required<Pick<RuntimeToolObserverContext, 'userId' | 'conversationId' | 'requestId'>> &
    RuntimeToolObserverContext | null {
    const userId = String(ctx?.userId ?? '').trim();
    const conversationId = String(ctx?.conversationId ?? '').trim();
    const requestId = String(ctx?.requestId ?? '').trim();

    if (!userId || !conversationId || !requestId) return null;

    return {
      ...ctx,
      userId,
      conversationId,
      requestId,
      traceId: ctx?.traceId ? String(ctx.traceId).trim() : undefined,
      idempotencyKey: ctx?.idempotencyKey
        ? String(ctx.idempotencyKey).trim()
        : undefined,
    };
  }
}