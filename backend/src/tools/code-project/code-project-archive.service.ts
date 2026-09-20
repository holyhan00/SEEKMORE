import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip = require('jszip');
import { createHash, randomUUID } from 'crypto';
import type { ArchiveManifest, ArchiveManifestEntry } from './archive-manifest.types';
import { ToolError } from '../toolstypes';

@Injectable()
export class CodeProjectArchiveService {
  private readonly maxEntries = Number(process.env.CODE_PROJECT_MAX_ENTRIES ?? 5_000);
  private readonly maxTotalBytes = Number(process.env.CODE_PROJECT_MAX_EXTRACTED_BYTES ?? 200 * 1024 * 1024);
  private readonly maxEntryBytes = Number(process.env.CODE_PROJECT_MAX_ENTRY_BYTES ?? 5 * 1024 * 1024);

  async withExtractedProject<T>(input: { objectId: string; fileName: string; buffer: Buffer }, run: (root: string, manifest: ArchiveManifest) => Promise<T>): Promise<T> {
    const extension = path.extname(input.fileName).toLowerCase();
    if (extension !== '.zip') throw new ToolError('CODE_PROJECT_ARCHIVE_UNSUPPORTED', 'code_project.inspect currently supports ZIP project archives only');

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `seekmore-code-project-${randomUUID()}-`));
    try {
      const manifest = await this.extractZip(input.objectId, input.buffer, tempRoot);
      return await run(tempRoot, manifest);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async extractZip(objectId: string, buffer: Buffer, root: string): Promise<ArchiveManifest> {
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: true }).catch(() => {
      throw new ToolError('CODE_PROJECT_ARCHIVE_INVALID', 'The uploaded ZIP archive is invalid or corrupted');
    });
    const files = Object.values(zip.files);
    if (files.length > this.maxEntries) throw new ToolError('CODE_PROJECT_ENTRY_LIMIT_EXCEEDED', `Archive contains more than ${this.maxEntries} entries`);

    const entries: ArchiveManifestEntry[] = [];
    let totalBytes = 0;
    let totalDirectories = 0;

    for (const item of files) {
      const normalizedPath = this.normalizeEntryPath(item.name);
      if (!normalizedPath) continue;
      if (item.dir) {
        totalDirectories += 1;
        entries.push({ path: item.name, normalizedPath, extension: '', sizeBytes: 0, objectKind: 'directory', safe: true, ignored: true, ignoreReason: 'directory' });
        continue;
      }

      const ignoredReason = this.ignoreReason(normalizedPath);
      const data = await item.async('nodebuffer');
      if (data.byteLength > this.maxEntryBytes) throw new ToolError('CODE_PROJECT_ENTRY_TOO_LARGE', `Archive entry exceeds limit: ${normalizedPath}`);
      totalBytes += data.byteLength;
      if (totalBytes > this.maxTotalBytes) throw new ToolError('CODE_PROJECT_TOTAL_SIZE_EXCEEDED', 'Archive extracted content exceeds the configured limit');

      const absolutePath = path.resolve(root, normalizedPath);
      if (!absolutePath.startsWith(`${path.resolve(root)}${path.sep}`)) throw new ToolError('CODE_PROJECT_PATH_ESCAPE', `Unsafe archive path: ${item.name}`);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
      await fs.writeFile(absolutePath, data, { mode: 0o600 });

      const extension = path.extname(normalizedPath).replace(/^\./, '').toLowerCase();
      entries.push({
        path: item.name,
        normalizedPath,
        extension,
        sizeBytes: data.byteLength,
        objectKind: this.isCodePath(normalizedPath) ? 'code' : 'file',
        hash: createHash('sha256').update(data).digest('hex'),
        safe: true,
        ignored: Boolean(ignoredReason),
        ignoreReason: ignoredReason,
      });
    }

    return {
      archiveObjectId: objectId,
      extractedRoot: root,
      totalEntries: entries.length,
      totalObjects: entries.filter((entry) => entry.objectKind !== 'directory').length,
      totalDirectories,
      totalBytes,
      entries,
      safety: { hasPathTraversal: false, hasExecutable: false, hasOversizedObject: false, hasTooManyObjects: false, warnings: [] },
      detectedBundleKind: 'code_project',
      bundleConfidence: 1,
      metadata: {},
    };
  }

  private normalizeEntryPath(value: string): string {
    const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('\u0000')) throw new ToolError('CODE_PROJECT_ENTRY_INVALID', 'Archive contains an invalid path');
    const safe = path.posix.normalize(normalized);
    if (safe === '..' || safe.startsWith('../') || path.posix.isAbsolute(safe)) throw new ToolError('CODE_PROJECT_PATH_ESCAPE', `Unsafe archive path: ${value}`);
    return safe.replace(/\/$/, '');
  }

  private ignoreReason(filePath: string): string | null {
    if (/(^|\/)(node_modules|dist|build|coverage|\.git|\.next|\.nuxt|target|vendor|__pycache__)(\/|$)/i.test(filePath)) return 'generated_or_dependency';
    if (/(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(filePath)) return 'system_file';
    return null;
  }

  private isCodePath(filePath: string): boolean {
    return /(^|\/)(package\.json|tsconfig\.json|nest-cli\.json|vite\.config\.[cm]?[jt]s|pyproject\.toml|requirements\.txt|pom\.xml|build\.gradle|Cargo\.toml|go\.mod|composer\.json|README(?:\.[^/]*)?)$/i.test(filePath)
      || /\.(ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|php|vue|svelte|css|scss|less|json|ya?ml|xml|toml|sql|prisma|md|rst)$/i.test(filePath);
  }
}
