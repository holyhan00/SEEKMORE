import { createHash } from 'node:crypto';
                                                  

import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { ToolError } from '../toolstypes';
import { resolveInsideWorkspace, resolveWorkspaceRootFromContext, toWorkspaceRelative } from '../workspace/workspace-path-sandbox';

@Injectable()
export class FilePatchTool implements Tool {
  name = 'file.patch';
  version = '1.0.0';
  description = 'Replace an exact text segment inside a workspace file.';
  tags = ['filesystem', 'local', 'patch'];
  timeoutMs = 20_000;
  inputSchema = {
    type: 'object',
    required: ['path', 'oldText', 'newText'],
    properties: {
      path: { type: 'string' },
      oldText: { type: 'string' },
      newText: { type: 'string' },
      replaceAll: { type: 'boolean' },
    },
    additionalProperties: false,
  };

  async execute(args: Dict, ctx: ToolContext) {
    const workspaceRoot = resolveWorkspaceRootFromContext(ctx);
    const abs = resolveInsideWorkspace(args.path, workspaceRoot);
    if (!fs.existsSync(abs)) throw new ToolError('FILE_NOT_FOUND', 'File does not exist', { path: args.path });
    const oldText = String(args.oldText ?? '');
    const newText = String(args.newText ?? '');
    if (!oldText) throw new ToolError('EMPTY_OLD_TEXT', 'oldText cannot be empty');
    const current = fs.readFileSync(abs, 'utf8');
    const first = current.indexOf(oldText);
    if (first < 0) {
      throw new ToolError('PATCH_ANCHOR_NOT_FOUND', 'oldText was not found in file', {
        path: args.path,
        oldTextPreview: oldText.slice(0, 200),
      });
    }
    const occurrences = current.split(oldText).length - 1;
    if (occurrences > 1 && args.replaceAll !== true) {
      throw new ToolError('PATCH_AMBIGUOUS', 'oldText occurs multiple times. Pass replaceAll=true or provide a more specific oldText.', {
        path: args.path,
        occurrences,
      });
    }
    const next = args.replaceAll === true
      ? current.split(oldText).join(newText)
      : current.slice(0, first) + newText + current.slice(first + oldText.length);
    fs.writeFileSync(abs, next, 'utf8');
    return {
      path: toWorkspaceRelative(abs, workspaceRoot),
      absolutePath: abs,
      contentHash: createHash('sha256').update(fs.readFileSync(abs)).digest('hex'),
      occurrencesReplaced: args.replaceAll === true ? occurrences : 1,
      previousSizeBytes: Buffer.byteLength(current, 'utf8'),
      sizeBytes: Buffer.byteLength(next, 'utf8'),
    };
  }
}
