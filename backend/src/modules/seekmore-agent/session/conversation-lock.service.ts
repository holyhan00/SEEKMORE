import { Injectable } from '@nestjs/common';
import { RuntimeFlowTraceLogger } from '../../../common/trace/runtime-flow-trace.logger';

interface QueueState {
  tail: Promise<void>;
  pending: number;
}

@Injectable()
export class ConversationLockService {
  private readonly queues = new Map<string, QueueState>();

  constructor(private readonly trace: RuntimeFlowTraceLogger) {}

  async runExclusive<T>(
    conversationId: string,
    action: () => Promise<T>,
    traceId?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const current = this.queues.get(conversationId) ?? {
      tail: Promise.resolve(),
      pending: 0,
    };

    current.pending += 1;
    const position = current.pending;
    const previous = current.tail;
    let release!: () => void;
    current.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(conversationId, current);

    const waitStartedAt = Date.now();
    this.trace.event('seekmore_agent.lock_requested', {
      trace: traceId ?? null,
      conversationId,
      queuePosition: position,
      pending: current.pending,
    });

    let waitHeartbeat: ReturnType<typeof setInterval> | null = null;
    if (position > 1) {
      waitHeartbeat = setInterval(() => {
        this.trace.warn('seekmore_agent.lock_waiting', {
          trace: traceId ?? null,
          conversationId,
          queuePosition: position,
          waitMs: Date.now() - waitStartedAt,
          pending: current.pending,
        });
      }, this.heartbeatMs());
      waitHeartbeat.unref?.();
    }

    let acquired = false;
    let actionStartedAt = 0;
    try {
      await previous;
      throwIfAborted(signal);
      if (waitHeartbeat) {
        clearInterval(waitHeartbeat);
        waitHeartbeat = null;
      }

      acquired = true;
      this.trace.event('seekmore_agent.lock_acquired', {
        trace: traceId ?? null,
        conversationId,
        queuePosition: position,
        waitMs: Date.now() - waitStartedAt,
        pending: current.pending,
      });

      actionStartedAt = Date.now();
      return await action();
    } finally {
      if (waitHeartbeat) clearInterval(waitHeartbeat);
      release();
      current.pending -= 1;
      if (current.pending === 0) this.queues.delete(conversationId);

      this.trace.event('seekmore_agent.lock_released', {
        trace: traceId ?? null,
        conversationId,
        heldMs: acquired ? Date.now() - actionStartedAt : 0,
        remaining: current.pending,
      });
    }
  }

  private heartbeatMs(): number {
    const raw = Number(process.env.SEEKMORE_AGENT_STAGE_HEARTBEAT_MS ?? 15_000);
    if (!Number.isFinite(raw)) return 15_000;
    return Math.max(5_000, Math.min(raw, 60_000));
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('AGENT_TURN_CANCELLED');
  error.name = 'AbortError';
  throw error;
}
