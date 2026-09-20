import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { localExecutionConfig } from '../../common/config/security.config';
import { truncateText } from '../workspace/workspace-path-sandbox';
import type { ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { ChildProcessTerminationService } from '../../modules/runtime-cancellation/child-process-termination.service';
import { TurnResourceRegistry } from '../../modules/runtime-cancellation/turn-resource.registry';

type TerminalChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface TerminalSessionSnapshot {
  sessionId: string;
  command: string;
  running: boolean;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  completedAt: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

interface TerminalSessionRecord {
  sessionId: string;
  ownerUserId: string;
  conversationId: string;
  workspaceId: string;
  workspaceRoot: string;
  command: string;
  child: TerminalChildProcess;
  startedAt: Date;
  completedAt: Date | null;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  expiresAt: number;
  timeout?: NodeJS.Timeout;
  traceId: string;
  cancelled: boolean;
  abortCleanup?: () => void;
  resourceCleanup?: () => void;
  terminationPromise?: Promise<void>;
}

@Injectable()
export class TerminalSessionStore implements OnModuleDestroy {
  private readonly sessions = new Map<string, TerminalSessionRecord>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly termination: ChildProcessTerminationService,
    private readonly resources: TurnResourceRegistry,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 60_000);
    this.cleanupTimer.unref?.();
  }

  /** Pure scoped observation: no TTL renewal, process start or output copying. */
  peekScope(userId: string, conversationId: string, workspaceId: string | null) {
    return [...this.sessions.values()].filter((row) => row.ownerUserId === userId
      && row.conversationId === conversationId && row.workspaceId === workspaceId)
      .slice(-16).map((row) => ({ sessionId: row.sessionId, running: !row.completedAt,
        exitCode: row.exitCode, signal: row.signal, startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null }));
  }

  start(command: string, timeoutMs: number, workspaceRoot: string, ctx: ToolContext): TerminalSessionSnapshot {
    this.assertExecutionEnabled();
    const workspaceId = String(ctx.metadata?.workspaceId ?? '').trim();
    if (!ctx.userId || !workspaceId) {
      throw new ToolError('TERMINAL_SCOPE_REQUIRED', 'Terminal sessions require an authenticated user and bound workspace');
    }

    const config = localExecutionConfig();
    const sessionId = randomUUID();
    const child = spawn('/bin/bash', ['-lc', command], {
      cwd: workspaceRoot,
      env: this.buildSafeEnv(workspaceRoot),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    const rec: TerminalSessionRecord = {
      sessionId,
      ownerUserId: ctx.userId,
      conversationId: ctx.conversationId,
      workspaceId,
      workspaceRoot,
      command,
      child,
      startedAt: new Date(),
      completedAt: null,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      expiresAt: Date.now() + config.sessionTtlMs,
      traceId: String(ctx.traceId ?? ''),
      cancelled: false,
    };

    const onAbort = () => {
      rec.cancelled = true;
      this.terminate(rec);
    };
    ctx.abortSignal?.addEventListener('abort', onAbort, { once: true });
    rec.abortCleanup = () => ctx.abortSignal?.removeEventListener('abort', onAbort);
    rec.resourceCleanup = this.resources.register(rec.traceId, {
      resourceId: `terminal-session:${sessionId}`,
      kind: 'background_child_process',
      cancel: async () => { rec.cancelled = true; this.terminate(rec); await rec.terminationPromise; },
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      rec.stdout = truncateText(rec.stdout + chunk.toString(), config.maxCapturedChars).text;
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      rec.stderr = truncateText(rec.stderr + chunk.toString(), config.maxCapturedChars).text;
    });
    child.on('close', (code, signal) => {
      if (rec.timeout) clearTimeout(rec.timeout);
      rec.completedAt = new Date();
      rec.exitCode = code;
      rec.signal = signal;
      rec.expiresAt = Date.now() + config.sessionTtlMs;
      rec.abortCleanup?.();
      rec.resourceCleanup?.();
    });
    child.on('error', (error) => {
      if (rec.timeout) clearTimeout(rec.timeout);
      rec.completedAt = new Date();
      rec.exitCode = rec.exitCode ?? 1;
      rec.stderr = truncateText(`${rec.stderr}\n${error.message}`.trim(), config.maxCapturedChars).text;
      rec.expiresAt = Date.now() + config.sessionTtlMs;
      rec.abortCleanup?.();
      rec.resourceCleanup?.();
    });

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      rec.timeout = setTimeout(() => this.terminate(rec), timeoutMs);
      rec.timeout.unref?.();
    }

    this.sessions.set(sessionId, rec);
    return this.snapshot(rec, 20_000);
  }

  read(sessionId: string, maxChars: number, ctx: ToolContext): TerminalSessionSnapshot {
    const rec = this.requireOwned(sessionId, ctx);
    rec.expiresAt = Date.now() + localExecutionConfig().sessionTtlMs;
    return this.snapshot(rec, maxChars);
  }

  kill(sessionId: string, ctx: ToolContext): TerminalSessionSnapshot {
    const rec = this.requireOwned(sessionId, ctx);
    this.terminate(rec);
    return this.snapshot(rec, 20_000);
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    for (const rec of this.sessions.values()) this.terminate(rec);
    this.sessions.clear();
  }

  private requireOwned(sessionId: string, ctx: ToolContext): TerminalSessionRecord {
    const rec = this.sessions.get(sessionId);
    if (!rec || rec.ownerUserId !== ctx.userId || rec.conversationId !== ctx.conversationId) {
      throw new ToolError('TERMINAL_SESSION_NOT_FOUND', 'Terminal session not found');
    }
    const workspaceId = String(ctx.metadata?.workspaceId ?? '').trim();
    if (!workspaceId || workspaceId !== rec.workspaceId) {
      throw new ToolError('TERMINAL_SESSION_NOT_FOUND', 'Terminal session not found');
    }
    return rec;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [sessionId, rec] of this.sessions) {
      if (rec.expiresAt > now) continue;
      this.terminate(rec);
      this.sessions.delete(sessionId);
    }
  }

  private terminate(rec: TerminalSessionRecord): void {
    if (rec.completedAt) return;
    if (!rec.terminationPromise) {
      rec.terminationPromise = this.termination.terminate(rec.child).then(() => undefined);
    }
  }

  private snapshot(rec: TerminalSessionRecord, maxChars: number): TerminalSessionSnapshot {
    const safeMaxChars = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 20_000;
    const stdout = truncateText(rec.stdout, safeMaxChars);
    const stderr = truncateText(rec.stderr, safeMaxChars);
    return {
      sessionId: rec.sessionId,
      command: rec.command,
      running: !rec.completedAt,
      exitCode: rec.exitCode,
      signal: rec.signal,
      startedAt: rec.startedAt.toISOString(),
      completedAt: rec.completedAt?.toISOString() ?? null,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
    };
  }

  private assertExecutionEnabled(): void {
    if (!localExecutionConfig().enabled) {
      throw new ToolError('LOCAL_EXECUTION_DISABLED', 'Local terminal execution is disabled by deployment policy');
    }
  }

  private buildSafeEnv(workspaceRoot: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { HOME: workspaceRoot };
    for (const key of ['PATH', 'LANG', 'LC_ALL', 'NODE_ENV']) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    return env;
  }
}
