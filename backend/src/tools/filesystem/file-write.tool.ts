                                                  

import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { ensureParentDir, resolveInsideWorkspace, resolveWorkspaceRootFromContext, toWorkspaceRelative } from '../workspace/workspace-path-sandbox';

@Injectable()
export class FileWriteTool implements Tool {
  name = 'file.write';
  version = '1.0.0';
  description = 'Write a text file inside the configured workspace. Existing files require overwrite=true.';
  tags = ['filesystem', 'local', 'write'];
  timeoutMs = 20_000;
  inputSchema = {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
      overwrite: { type: 'boolean' },
      expectedHash: { type: 'string' },
      expectedAbsent: { type: 'boolean' },
    },
    additionalProperties: false,
  };

  async execute(args: Dict, ctx: ToolContext) {
    const workspaceRoot = resolveWorkspaceRootFromContext(ctx);
    const abs = resolveInsideWorkspace(args.path, workspaceRoot);
    const content = String(args.content ?? '');
    const exists = fs.existsSync(abs);
    if (args.expectedAbsent === true && exists) {
      throw new ToolError('FILE_EXPECTED_ABSENT', 'File was created or changed after approval.', { path: args.path });
    }
    if (args.expectedHash) {
      if (!exists) throw new ToolError('FILE_HASH_MISMATCH', 'Expected file is missing.', { path: args.path });
      const actualHash = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      if (actualHash !== String(args.expectedHash)) {
        throw new ToolError('FILE_HASH_MISMATCH', 'File changed after approval.', { path: args.path });
      }
    }
    if (exists && args.overwrite !== true) {
      throw new ToolError('FILE_EXISTS', 'File exists. Pass overwrite=true to replace it.', { path: args.path });
    }
    ensureParentDir(abs);
    const previous = exists ? fs.readFileSync(abs, 'utf8') : null;
    fs.writeFileSync(abs, content, 'utf8');
    return {
      path: toWorkspaceRelative(abs, workspaceRoot),
      absolutePath: abs,
      contentHash: createHash('sha256').update(fs.readFileSync(abs)).digest('hex'),
      created: !exists,
      overwritten: exists,
      previousSizeBytes: previous == null ? null : Buffer.byteLength(previous, 'utf8'),
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    };
  }
}
