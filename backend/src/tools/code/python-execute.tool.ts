                                                

import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { localExecutionConfig } from '../../common/config/security.config';
import { resolveWorkspaceRootFromContext, truncateText } from '../workspace/workspace-path-sandbox';
import { TerminalPolicyService } from '../terminal/terminal-policy.service';
import { randomUUID } from 'node:crypto';
import { ChildProcessTerminationService } from '../../modules/runtime-cancellation/child-process-termination.service';
import { TurnResourceRegistry } from '../../modules/runtime-cancellation/turn-resource.registry';

@Injectable()
export class PythonExecuteTool implements Tool {
  name = 'python.execute';
  version = '1.0.0';
  description = 'Execute Python code in a temporary script under the configured workspace context.';
  tags = ['code', 'python', 'execution'];
  timeoutMs = 120_000;
  inputSchema = {
    type: 'object',
    required: ['code'],
    properties: {
      code: { type: 'string' },
      timeoutMs: { type: 'number', minimum: 1000, maximum: 600000 },
      maxOutputChars: { type: 'number', minimum: 1000, maximum: 200000 },
    },
    additionalProperties: false,
  };

  constructor(
    private readonly policy: TerminalPolicyService,
    private readonly termination: ChildProcessTerminationService,
    private readonly resources: TurnResourceRegistry,
  ) {}

  async execute(args: Dict, ctx: ToolContext) {
    if (!localExecutionConfig().enabled) throw new ToolError('LOCAL_EXECUTION_DISABLED', 'Local Python execution is disabled by deployment policy');
    if (ctx.metadata?.approvalGranted !== true) throw new ToolError('APPROVAL_REQUIRED', 'Python execution requires a verified approval');
    const code = String(args.code ?? '');
    const timeoutMs = Math.max(1000, Math.min(Number(args.timeoutMs ?? 120000), 600000));
    const maxOutputChars = Math.max(1000, Math.min(Number(args.maxOutputChars ?? 40000), 200000));
    const workspaceRoot = resolveWorkspaceRootFromContext(ctx);
    const runtimeTmpRoot = path.join(workspaceRoot, '.seekmore-runtime');
    fs.mkdirSync(runtimeTmpRoot, { recursive: true, mode: 0o700 });
    const tmpDir = fs.mkdtempSync(path.join(runtimeTmpRoot, 'python-'));
    const scriptPath = path.join(tmpDir, 'main.py');
    fs.writeFileSync(scriptPath, code, 'utf8');
    this.policy.assertAllowed(`python3 ${scriptPath}`);

    return await new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn('python3', [scriptPath], {
        cwd: workspaceRoot,
        env: this.buildSafeEnv(workspaceRoot),
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timeoutHit = false;
      let cancelled = false;
      let settled = false;
      const unregister = this.resources.register(ctx.traceId ?? '', {
        resourceId: `process:${randomUUID()}`,
        kind: 'child_process',
        cancel: () => this.termination.terminate(child).then(() => undefined),
      });
      const onAbort = () => { cancelled = true; void this.termination.terminate(child); };
      ctx.abortSignal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        ctx.abortSignal?.removeEventListener('abort', onAbort);
        unregister();
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {            }
      };
      const timer = setTimeout(() => {
        timeoutHit = true;
        void this.termination.terminate(child);
      }, timeoutMs);
      child.stdout.on('data', (chunk) => { stdout = truncateText(stdout + chunk.toString('utf8'), maxOutputChars).text; });
      child.stderr.on('data', (chunk) => { stderr = truncateText(stderr + chunk.toString('utf8'), maxOutputChars).text; });
      child.on('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (cancelled || ctx.abortSignal?.aborted) {
          reject(new ToolError('TOOL_CANCELLED', 'Python execution was cancelled'));
          return;
        }
        const out = truncateText(stdout, maxOutputChars);
        const err = truncateText(stderr, maxOutputChars);
        resolve({
          exitCode,
          signal,
          timedOut: timeoutHit,
          durationMs: Date.now() - started,
          stdout: out.text,
          stderr: err.text,
          truncated: out.truncated || err.truncated,
        });
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (cancelled || ctx.abortSignal?.aborted) {
          reject(new ToolError('TOOL_CANCELLED', 'Python execution was cancelled'));
          return;
        }
        resolve({ exitCode: null, signal: null, timedOut: timeoutHit, durationMs: Date.now() - started, stdout, stderr: String((error as Error).message ?? error), truncated: false });
      });
    });
  }

  private buildSafeEnv(workspaceRoot: string): NodeJS.ProcessEnv {
    const allowed = ['PATH', 'LANG', 'LC_ALL'];
    const env: NodeJS.ProcessEnv = { HOME: workspaceRoot };
    for (const key of allowed) {
      if (process.env[key]) env[key] = process.env[key];
    }
    return env;
  }
}
