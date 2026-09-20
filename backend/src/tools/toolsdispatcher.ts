                                        
import { Injectable, Logger } from '@nestjs/common';
import {
  Dict,
  ToolContext,
  ToolResult,
  ToolError,
  DispatchOptions,
} from './toolstypes';
import { ToolsRegistry } from './toolsregistry';

export interface ToolInvocation {
  name: string;
  args?: Dict;
  timeoutMs?: number;
  idempotencyKey?: string;
}

export type ExecMode = 'sequential' | 'parallel';

export interface StreamHooks {
  onToolStart?(e: {
    callId: string;
    tool: string;
    version?: string;
    argsPreview: string;
    ctx: Pick<
      ToolContext,
      'userId' | 'conversationId' | 'traceId' | 'requestId' | 'idempotencyKey'
    >;
    ts: number;
  }): void;

  onToolDelta?(e: {
    callId: string;
    tool: string;
    chunk: string | Uint8Array | Dict;
    ts: number;
  }): void;

  onToolComplete?(e: {
    callId: string;
    tool: string;
    result: ToolResult;
    ts: number;
  }): void;

  onError?(e: {
    callId: string;
    tool: string;
    error: { code: string; message: string };
    ts: number;
  }): void;
}

export interface SingleDispatchOptions extends DispatchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  stream?: StreamHooks;
}

export interface ManyDispatchOptions extends DispatchOptions {
  mode?: ExecMode;
  concurrency?: number;
  signal?: AbortSignal;
  stream?: StreamHooks;
}

export interface SingleDispatchResult {
  data: null;
  callId: string;
  tool: string;
  result: ToolResult;
}

export interface ManyDispatchResult {
  results: SingleDispatchResult[];
}

@Injectable()
export class ToolsDispatcher {
  private readonly logger = new Logger(ToolsDispatcher.name);

  constructor(private readonly registry: ToolsRegistry) {}

  async dispatch(
    invocation: ToolInvocation,
    ctx: ToolContext,
    opt: SingleDispatchOptions = {}
  ): Promise<SingleDispatchResult> {
    const callId = this.makeCallId(invocation);
    const now = Date.now();

    const toolName = invocation.name;
    const args = invocation.args ?? {};
    const timeoutMs = opt.timeoutMs ?? invocation.timeoutMs ?? undefined;
    const signal = this.mergeAbortSignals(ctx.abortSignal, opt.signal);

    opt.stream?.onToolStart?.({
      callId,
      tool: toolName,
      version: undefined,
      argsPreview: this.truncateJSON(args),
      ctx: {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        traceId: ctx.traceId,
        requestId: ctx.requestId,
        idempotencyKey: ctx.idempotencyKey,
      },
      ts: now,
    });

    try {
      const result = await this.registry.execute(
        toolName,
        args,
        { ...ctx, abortSignal: signal },
        {
          timeoutMs,
          idempotencyTtlMs: opt.idempotencyTtlMs,
          maxConcurrent: opt.maxConcurrent,
        }
      );

      opt.stream?.onToolComplete?.({
        callId,
        tool: toolName,
        result,
        ts: Date.now(),
      });

      return { data: null, callId, tool: toolName, result };
    } catch (err: any) {
      const msg = String(err?.message ?? '');

      const toolErr = this.normalizeError(err);
      opt.stream?.onError?.({
        callId,
        tool: toolName,
        error: { code: toolErr.code, message: toolErr.message },
        ts: Date.now(),
      });

      const fail: ToolResult = {
        ok: false,
        status: 'error',
        error: { code: toolErr.code, message: toolErr.message, details: toolErr.details },
        meta: {
          tool: toolName,
          duration_ms: Date.now() - now,
          traceId: ctx.traceId,
          requestId: ctx.requestId,
          idempotencyKey: ctx.idempotencyKey,
        },
      };
      return { data: null, callId, tool: toolName, result: fail };
    }
  }

  async dispatchMany(
    invocations: ToolInvocation[],
    ctx: ToolContext,
    opt: ManyDispatchOptions = {}
  ): Promise<ManyDispatchResult> {
    const mode = opt.mode ?? 'parallel';
    const stream = opt.stream;

    if (mode === 'sequential') {
      const results: SingleDispatchResult[] = [];
      for (const inv of invocations) {
        this.throwIfAborted(opt.signal);
        const r = await this.dispatch(inv, ctx, {
          timeoutMs: inv.timeoutMs,
          idempotencyTtlMs: opt.idempotencyTtlMs,
          maxConcurrent: opt.maxConcurrent,
          signal: opt.signal,
          stream,
        });
        results.push(r);
      }
      return { results };
    }

    const concurrency = Math.max(1, opt.concurrency ?? 4);
    const results: SingleDispatchResult[] = new Array(invocations.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= invocations.length) break;

        this.throwIfAborted(opt.signal);
        const inv = invocations[idx];
        const r = await this.dispatch(inv, ctx, {
          timeoutMs: inv.timeoutMs,
          idempotencyTtlMs: opt.idempotencyTtlMs,
          maxConcurrent: opt.maxConcurrent,
          signal: opt.signal,
          stream,
        });
        results[idx] = r;
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, invocations.length) }, () => worker());
    await Promise.all(workers);
    return { results };
  }

  private makeCallId(inv: ToolInvocation): string {
    return `${inv.name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }

  private truncateJSON(obj: any, max = 400): string {
    try {
      const s = JSON.stringify(obj);
      return s.length <= max ? s : s.slice(0, max) + '…';
    } catch {
      return '[Unserializable Args]';
    }
  }

  private normalizeError(err: any): ToolError {
    if (err instanceof ToolError) return err;
    if (err?.name === 'AbortError') return new ToolError('CANCELED', 'Operation canceled');
    return new ToolError('INTERNAL', err?.message || 'Tool execution failed', err);
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new ToolError('CANCELED', 'Operation canceled');
  }

  private mergeAbortSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
    if (!a && !b) return undefined;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (a) a.aborted ? ctrl.abort() : a.addEventListener('abort', onAbort, { once: true });
    if (b) b.aborted ? ctrl.abort() : b.addEventListener('abort', onAbort, { once: true });
    return ctrl.signal;
  }
}