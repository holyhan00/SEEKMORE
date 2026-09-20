                                                  

import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { resolveInsideWorkspace, resolveWorkspaceRootFromContext, truncateText } from '../workspace/workspace-path-sandbox';
import { TerminalPolicyService } from './terminal-policy.service';
import { TerminalSessionStore } from './terminal-session.store';
import { localExecutionConfig } from '../../common/config/security.config';
import { ToolError } from '../toolstypes';
import { randomUUID } from 'node:crypto';
import { ChildProcessTerminationService } from '../../modules/runtime-cancellation/child-process-termination.service';
import { TurnResourceRegistry } from '../../modules/runtime-cancellation/turn-resource.registry';

@Injectable()
export class TerminalRunTool implements Tool {
  name = 'terminal.run';
  version = '1.0.0';
  description = 'Run a shell command in the configured workspace with safety checks and timeout.';
  tags = ['terminal', 'local', 'execution'];
  timeoutMs = 120_000;
  inputSchema = {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string' },
      timeoutMs: { type: 'number', minimum: 1000, maximum: 600000 },
      background: { type: 'boolean' },
      maxOutputChars: { type: 'number', minimum: 1000, maximum: 200000 },
    },
    additionalProperties: false,
  };

  constructor(
    private readonly policy: TerminalPolicyService,
    private readonly sessions: TerminalSessionStore,
    private readonly termination: ChildProcessTerminationService,
    private readonly resources: TurnResourceRegistry,
  ) {}

  assessRisk(args: Dict) {
    if (!localExecutionConfig().enabled) {
      return {
        riskLevel: 'forbidden' as const,
        requiresApproval: false,
        reasonCodes: ['terminal:local_execution_disabled'],
      };
    }

    const command = String(args.command ?? '').trim();
    try {
      this.policy.assertAllowed(command);
      return {
        riskLevel: 'high' as const,
        requiresApproval: true,
        reasonCodes: ['terminal:command_allowed_by_safety_policy'],
        descriptor: { command },
      };
    } catch (error) {
      if (error instanceof ToolError) {
        return {
          riskLevel: 'forbidden' as const,
          requiresApproval: false,
          reasonCodes: [`terminal:${error.code}`],
          descriptor: { command, policyCode: error.code },
        };
      }
      throw error;
    }
  }

  async execute(args: Dict, ctx: ToolContext) {
    if (!localExecutionConfig().enabled) throw new ToolError('LOCAL_EXECUTION_DISABLED', 'Local terminal execution is disabled by deployment policy');
    if (ctx.metadata?.approvalGranted !== true) throw new ToolError('APPROVAL_REQUIRED', 'Terminal execution requires a verified approval');
    const command = String(args.command ?? '').trim();
    this.policy.assertAllowed(command);
    const timeoutMs = Math.max(1000, Math.min(Number(args.timeoutMs ?? 120000), 600000));
    const workspaceRoot = resolveWorkspaceRootFromContext(ctx);
    const cwd = args.cwd == null || String(args.cwd).trim() === '.'
      ? workspaceRoot
      : resolveInsideWorkspace(String(args.cwd), workspaceRoot);
    if (args.background === true) {
      return this.sessions.start(command, timeoutMs, cwd, ctx);
    }
    const maxOutputChars = Math.max(1000, Math.min(Number(args.maxOutputChars ?? 40000), 200000));
    return await new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn('/bin/bash', ['-lc', command], {
        cwd,
        env: this.buildSafeEnv(cwd),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      let stdout = '';
      let stderr = '';
      let timeoutHit = false;
      let cancelled = false;
      let settled = false;
      const resourceId = `process:${randomUUID()}`;
      const unregister = this.resources.register(ctx.traceId ?? '', {
        resourceId,
        kind: 'child_process',
        cancel: () => this.termination.terminate(child).then(() => undefined),
      });
      const onAbort = () => {
        cancelled = true;
        void this.termination.terminate(child);
      };
      ctx.abortSignal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        ctx.abortSignal?.removeEventListener('abort', onAbort);
        unregister();
      };
      const timer = setTimeout(() => {
        timeoutHit = true;
        void this.termination.terminate(child);
      }, timeoutMs);

      child.stdout.on('data', (chunk: { toString(encoding?: string): string }) => { stdout = truncateText(stdout + chunk.toString('utf8'), maxOutputChars).text; });
      child.stderr.on('data', (chunk: { toString(encoding?: string): string }) => { stderr = truncateText(stderr + chunk.toString('utf8'), maxOutputChars).text; });
      child.on('close', (exitCode: number | null, signal: string | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (cancelled || ctx.abortSignal?.aborted) {
          reject(new ToolError('TOOL_CANCELLED', 'Terminal execution was cancelled'));
          return;
        }
        const out = truncateText(stdout, maxOutputChars);
        const err = truncateText(stderr, maxOutputChars);
        resolve({
          command,
          cwd,
          exitCode,
          signal,
          timedOut: timeoutHit,
          durationMs: Date.now() - started,
          stdout: out.text,
          stderr: err.text,
          truncated: out.truncated || err.truncated,
        });
      });
      child.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (cancelled || ctx.abortSignal?.aborted) {
          reject(new ToolError('TOOL_CANCELLED', 'Terminal execution was cancelled'));
          return;
        }
        resolve({
          command,
          cwd,
          exitCode: null,
          signal: null,
          timedOut: timeoutHit,
          durationMs: Date.now() - started,
          stdout,
          stderr: String((error as Error).message ?? error),
          truncated: false,
        });
      });
    });
  }

  private buildSafeEnv(workspaceRoot: string): NodeJS.ProcessEnv {
    const allowed = ['PATH', 'LANG', 'LC_ALL', 'NODE_ENV'];
    const env: NodeJS.ProcessEnv = { HOME: workspaceRoot };
    for (const key of allowed) {
      if (process.env[key]) env[key] = process.env[key];
    }
    return env;
  }
}
