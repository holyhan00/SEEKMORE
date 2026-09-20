                                                   

import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Dict, Tool, ToolContext } from '../toolstypes';
import {
  DEFAULT_EXCLUDED_DIRS,
  isProbablyBinary,
  resolveWorkspaceRootFromContext,
  toWorkspaceRelative,
  truncateText,
} from '../workspace/workspace-path-sandbox';

const FILE_SEARCH_EXCLUDED_DIRS = new Set([
  ...DEFAULT_EXCLUDED_DIRS,
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
]);

@Injectable()
export class FileSearchTool implements Tool {
  name = 'file.search';
  version = '1.0.0';
  description = 'Search workspace text files by content using ripgrep when available, with a safe fallback.';
  tags = ['filesystem', 'local', 'search'];
  timeoutMs = 20_000;
  inputSchema = {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      maxResults: { type: 'number', minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  };

  async execute(args: Dict, ctx: ToolContext) {
    const workspaceRoot = resolveWorkspaceRootFromContext(ctx);
    const pattern = stripNullBytes(String(args.pattern ?? '')).trim();
    const maxResults = Math.max(1, Math.min(Number(args.maxResults ?? 50), 200));
    if (!pattern) return { pattern, results: [], total: 0 };

    const excludeGlobs = [...FILE_SEARCH_EXCLUDED_DIRS].flatMap((dir) => [
      '-g',
      `!${dir}/**`,
    ]);
    const rg = spawnSync('rg', [
      '--line-number',
      '--no-heading',
      '--hidden',
      '--max-filesize',
      '1M',
      ...excludeGlobs,
      '--',
      pattern,
      workspaceRoot,
    ], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024 * 8,
    });

    const rgOutput = typeof rg.stdout === 'string'
      ? stripNullBytes(rg.stdout)
      : '';
    if (!rg.error || rgOutput.trim()) {
      const outputLines = rgOutput.split('\n').filter(Boolean);
      const lines = outputLines.slice(0, maxResults);
      const results = lines.map((line) => {
        const match = /^(.*?):(\d+):(.*)$/.exec(line);
        if (!match) return { path: line, line: null, preview: '' };
        return {
          path: toWorkspaceRelative(match[1], workspaceRoot),
          line: Number(match[2]),
          preview: truncateText(stripNullBytes(match[3]).trim(), 240).text,
        };
      });
      return {
        pattern,
        engine: 'ripgrep',
        results,
        total: results.length,
        truncated: Boolean(rg.error) || outputLines.length > maxResults,
      };
    }

    const results: Array<{ path: string; line: number | null; preview: string }> = [];
    const lower = pattern.toLowerCase();
    const walk = (dir: string) => {
      if (results.length >= maxResults) return;
      let items: fs.Dirent[] = [];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const item of items) {
        if (results.length >= maxResults) return;
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (!FILE_SEARCH_EXCLUDED_DIRS.has(item.name)) walk(abs);
          continue;
        }
        if (!item.isFile()) continue;
        let text = '';
        try {
          const stat = fs.statSync(abs);
          if (stat.size > 1024 * 1024) continue;
          const raw = fs.readFileSync(abs);
          if (isProbablyBinary(raw) || raw.includes(0)) continue;
          text = stripNullBytes(raw.toString('utf8'));
        } catch { continue; }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && results.length < maxResults; i += 1) {
          if (lines[i].toLowerCase().includes(lower)) {
            results.push({
              path: toWorkspaceRelative(abs, workspaceRoot),
              line: i + 1,
              preview: truncateText(stripNullBytes(lines[i]).trim(), 240).text,
            });
          }
        }
      }
    };
    walk(workspaceRoot);
    return {
      pattern,
      engine: 'fallback',
      results,
      total: results.length,
      truncated: results.length >= maxResults,
    };
  }
}

function stripNullBytes(value: string): string {
  return value.includes('\u0000')
    ? value.replace(/\u0000/g, '')
    : value;
}
