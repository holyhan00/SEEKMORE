import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { resolveInsideWorkspace, resolveWorkspaceRootFromContext, toWorkspaceRelative } from '../workspace/workspace-path-sandbox';

@Injectable()
export class FileDeleteTool implements Tool {
  name = 'file.delete';
  version = '1.0.0';
  description = 'Delete one regular file inside the configured workspace after an approved, hash-bound proposal.';
  tags = ['filesystem', 'local', 'write', 'delete'];
  timeoutMs = 20_000;
  inputSchema = {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      expectedHash: { type: 'string' },
    },
    additionalProperties: false,
  };

  async execute(args: Dict, ctx: ToolContext) {
    const workspaceRoot = resolveWorkspaceRootFromContext(ctx);
    const abs = resolveInsideWorkspace(args.path, workspaceRoot);
    if (!fs.existsSync(abs)) throw new ToolError('FILE_NOT_FOUND', 'File does not exist', { path: args.path });
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new ToolError('NOT_A_FILE', 'Only regular files can be deleted', { path: args.path });
    const previous = fs.readFileSync(abs);
    if (args.expectedHash) {
      const actual = createHash('sha256').update(previous).digest('hex');
      if (actual !== String(args.expectedHash)) throw new ToolError('FILE_HASH_MISMATCH', 'File changed before deletion', { path: args.path });
    }
    fs.unlinkSync(abs);
    return {
      path: toWorkspaceRelative(abs, workspaceRoot),
      absolutePath: abs,
      deleted: true,
      previousSizeBytes: previous.length,
    };
  }
}
