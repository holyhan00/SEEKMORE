                                                        

import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import { resolveWorkspaceRootFromContext, shouldSkipDir, toWorkspaceRelative } from './workspace-path-sandbox';

@Injectable()
export class WorkspaceInspectTool implements Tool {
  name = 'workspace.inspect';
  version = '1.0.0';
  description = 'Inspect the configured local workspace without scanning heavy generated directories.';
  tags = ['workspace', 'local', 'inspection'];
  timeoutMs = 15_000;
  inputSchema = {
    type: 'object',
    properties: {
      maxEntries: { type: 'number', minimum: 1, maximum: 500 },
    },
    additionalProperties: false,
  };

  async execute(args: Dict, ctx: ToolContext) {
    const workspaceRoot = resolveWorkspaceRootFromContext(ctx);
    const maxEntries = Math.max(20, Math.min(Number(args.maxEntries ?? 120), 500));
    const entries: Array<{ path: string; type: 'file' | 'dir'; sizeBytes?: number }> = [];

    const walk = (dir: string) => {
      if (entries.length >= maxEntries) return;
      let items: fs.Dirent[] = [];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        if (entries.length >= maxEntries) return;
        if (item.name.startsWith('.') && item.name !== '.env.example') {
          if (item.name !== '.seekmore') continue;
        }
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (shouldSkipDir(item.name)) continue;
          entries.push({ path: toWorkspaceRelative(abs, workspaceRoot), type: 'dir' });
          if (path.relative(workspaceRoot, abs).split(path.sep).length < 3) walk(abs);
        } else if (item.isFile()) {
          let sizeBytes: number | undefined;
          try { sizeBytes = fs.statSync(abs).size; } catch { sizeBytes = undefined; }
          entries.push({ path: toWorkspaceRelative(abs, workspaceRoot), type: 'file', sizeBytes });
        }
      }
    };

    walk(workspaceRoot);

    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    let packageJson: Record<string, unknown> | null = null;
    if (fs.existsSync(packageJsonPath)) {
      try { packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')); } catch { packageJson = null; }
    }

    let gitStatus: string | null = null;
    try {
      gitStatus = execFileSync('git', ['status', '--short'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      gitStatus = null;
    }

    return {
      workspaceRoot,
      cwd: process.cwd(),
      packageJson: packageJson
        ? {
            name: packageJson.name ?? null,
            version: packageJson.version ?? null,
            scripts: packageJson.scripts ?? null,
            packageManager: packageJson.packageManager ?? null,
          }
        : null,
      git: {
        available: gitStatus !== null,
        statusShort: gitStatus,
      },
      entries,
      truncated: entries.length >= maxEntries,
    };
  }
}
