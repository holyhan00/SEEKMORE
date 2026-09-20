import { createHash } from 'node:crypto';
                                                 

import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { isProbablyBinary, resolveInsideWorkspace, resolveWorkspaceRootFromContext, toWorkspaceRelative, truncateText } from '../workspace/workspace-path-sandbox';

@Injectable()
export class FileReadTool implements Tool {
  name = 'file.read';
  version = '1.0.0';
  description = 'Read a text file from the configured workspace with optional offset and limit.';
  tags = ['filesystem', 'local', 'read'];
  timeoutMs = 15_000;
  inputSchema = {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      offset: { type: 'number', minimum: 0 },
      limit: { type: 'number', minimum: 1, maximum: 200000 },
    },
    additionalProperties: false,
  };

  async execute(args: Dict, ctx: ToolContext) {
    const workspaceRoot = resolveWorkspaceRootFromContext(ctx);
    const abs = resolveInsideWorkspace(args.path, workspaceRoot);
    if (!fs.existsSync(abs)) throw new ToolError('FILE_NOT_FOUND', 'File does not exist', { path: args.path });
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new ToolError('NOT_A_FILE', 'Path is not a file', { path: args.path });
    const raw = fs.readFileSync(abs);
    if (isProbablyBinary(raw)) throw new ToolError('BINARY_FILE', 'Binary files are not readable through file.read', { path: args.path });
    const offset = Math.max(0, Number(args.offset ?? 0));
    const limit = Math.max(1, Math.min(Number(args.limit ?? 20000), 200000));
    const content = raw.toString('utf8');
    const sliced = content.slice(offset);
    const out = truncateText(sliced, limit);
    return {
      path: toWorkspaceRelative(abs, workspaceRoot),
      absolutePath: abs,
      contentHash: createHash('sha256').update(raw).digest('hex'),
      sizeBytes: stat.size,
      offset,
      limit,
      content: out.text,
      truncated: out.truncated || offset + out.text.length < content.length,
    };
  }
}
