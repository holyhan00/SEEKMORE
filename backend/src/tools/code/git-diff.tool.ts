                                          

import { Injectable } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { resolveWorkspaceRootFromContext, truncateText } from '../workspace/workspace-path-sandbox';

@Injectable()
export class GitDiffTool implements Tool {
  name = 'git.diff';
  version = '1.0.0';
  description = 'Read git diff for the configured workspace.';
  tags = ['git', 'workspace'];
  timeoutMs = 15_000;
  inputSchema = {
    type: 'object',
    properties: {
      staged: { type: 'boolean' },
      maxChars: { type: 'number', minimum: 1000, maximum: 200000 },
    },
    additionalProperties: false,
  };

  async execute(args: Dict, ctx: ToolContext) {
    const cwd = resolveWorkspaceRootFromContext(ctx);
    const maxChars = Math.max(1000, Math.min(Number(args.maxChars ?? 60000), 200000));
    const argv = args.staged === true ? ['diff', '--cached'] : ['diff'];
    const diff = execFileSync('git', argv, { cwd, encoding: 'utf8', timeout: 12000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 8 });
    const out = truncateText(diff, maxChars);
    return { cwd, staged: args.staged === true, diff: out.text, truncated: out.truncated };
  }
}
