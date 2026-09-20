                                            

import { Injectable } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { resolveWorkspaceRootFromContext, truncateText } from '../workspace/workspace-path-sandbox';

@Injectable()
export class GitStatusTool implements Tool {
  name = 'git.status';
  version = '1.0.0';
  description = 'Read git status for the configured workspace.';
  tags = ['git', 'workspace'];
  timeoutMs = 10_000;
  inputSchema = { type: 'object', properties: {}, additionalProperties: false };

  async execute(_args: Dict, ctx: ToolContext) {
    const cwd = resolveWorkspaceRootFromContext(ctx);
    const short = execFileSync('git', ['status', '--short'], { cwd, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] });
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return { cwd, branch, short: truncateText(short, 40000).text };
  }
}
