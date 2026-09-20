                                                        

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ToolError } from '../toolstypes';

export const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
]);

export type WorkspaceLikeToolContext = { metadata?: Record<string, any> | null } | null | undefined;

export function resolveWorkspaceRootFromContext(ctx?: WorkspaceLikeToolContext): string {
  const fromContext = String(ctx?.metadata?.workspaceRoot ?? '').trim();
  const candidate = fromContext || String(process.env.SEEKMORE_WORKSPACE_ROOT ?? '').trim();

  if (!candidate) {
    throw new ToolError('WORKSPACE_REQUIRED', 'Workspace is required for local file, terminal and code tools');
  }

  return normalizeExistingPath(candidate);
}

export function resolveWorkspaceRoot(): string {
  const configured = String(process.env.SEEKMORE_WORKSPACE_ROOT ?? '').trim();

  if (!configured) {
    throw new ToolError('WORKSPACE_REQUIRED', 'Workspace is required for local file, terminal and code tools');
  }

  return normalizeExistingPath(configured);
}

export function resolveInsideWorkspace(inputPath: unknown, workspaceRoot = resolveWorkspaceRoot()): string {
  const raw = String(inputPath ?? '').trim();

  if (!raw) {
    throw new ToolError('INVALID_PATH', 'Path is required');
  }

  if (raw.includes('\0')) {
    throw new ToolError('INVALID_PATH', 'Path contains invalid null byte');
  }

  const normalizedRoot = normalizeExistingPath(workspaceRoot);

  const candidate = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(normalizedRoot, raw);

  assertPathWithinWorkspace(candidate, normalizedRoot, raw, 'Path is outside the configured workspace');

  const existing = fs.existsSync(candidate) ? candidate : findExistingParent(candidate, normalizedRoot);
  const realExisting = normalizeExistingPath(existing);

  assertPathWithinWorkspace(
    realExisting,
    normalizedRoot,
    raw,
    'Path resolves outside the configured workspace',
  );

  if (fs.existsSync(candidate)) {
    const realCandidate = normalizeExistingPath(candidate);

    assertPathWithinWorkspace(
      realCandidate,
      normalizedRoot,
      raw,
      'Path is outside the configured workspace',
    );

    return realCandidate;
  }

  return path.resolve(candidate);
}

function normalizeExistingPath(inputPath: string): string {
  return fs.realpathSync.native(path.resolve(inputPath));
}

function assertPathWithinWorkspace(candidateAbsPath: string, normalizedRoot: string, rawPath: string, message: string): void {
  const relative = path.relative(normalizedRoot, path.resolve(candidateAbsPath));

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ToolError('PATH_OUTSIDE_WORKSPACE', message, {
      path: rawPath,
      workspaceRoot: normalizedRoot,
    });
  }
}

function findExistingParent(absPath: string, workspaceRoot: string): string {
  let current = path.resolve(absPath);
  const normalizedRoot = path.resolve(workspaceRoot);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);

    if (parent === current) {
      return normalizedRoot;
    }

    const relative = path.relative(normalizedRoot, parent);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return normalizedRoot;
    }

    current = parent;
  }

  return current;
}

export function toWorkspaceRelative(absPath: string, workspaceRoot = resolveWorkspaceRoot()): string {
  const normalizedRoot = normalizeExistingPath(workspaceRoot);
  const resolvedAbs = fs.existsSync(absPath) ? normalizeExistingPath(absPath) : path.resolve(absPath);
  const rel = path.relative(normalizedRoot, resolvedAbs);
  return rel || '.';
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}

export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const safeMax = Math.max(256, Math.min(maxChars || 20000, 200000));
  if (text.length <= safeMax) return { text, truncated: false };
  return { text: text.slice(0, safeMax), truncated: true };
}

export function shouldSkipDir(name: string): boolean {
  return DEFAULT_EXCLUDED_DIRS.has(name);
}