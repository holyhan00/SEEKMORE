import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { SkillSourceKind } from '@prisma/client';
import * as JSZip from 'jszip';
import * as path from 'path';
import {
  inspectZipCentralDirectory,
  ZipContainerError,
} from '../../../document-parser/parsers/zip-central-directory.util';
import { SKILL_PACKAGE_LIMITS } from '../domain/skill-policy';
import { SkillPathPolicy } from '../security/skill-path-policy';
import type { SkillImportPackage } from '../specification/skill-generation.types';

interface RepositoryLocator {
  owner: string;
  repo: string;
  ref: string | null;
  requestedPath: string;
  sourceUrl: string;
}

@Injectable()
export class SkillImportPackageReader {
  constructor(private readonly paths: SkillPathPolicy) {}

  async read(input: {
    file?: Express.Multer.File | null;
    repositoryUrl?: string | null;
    content?: string | null;
  }): Promise<SkillImportPackage> {
    if (input.file?.buffer?.length) return this.fromFile(input.file);
    if (input.repositoryUrl?.trim()) {
      return this.fromGithub(input.repositoryUrl.trim());
    }
    if (typeof input.content === 'string' && input.content.length > 0) {
      if (!this.looksLikeSkillMarkdown(input.content)) {
        throw new BadRequestException('SKILL_IMPORT_STANDARD_DOCUMENT_REQUIRED');
      }
      return {
        sourceKind: SkillSourceKind.IMPORTED,
        sourceRef: null,
        sourceRevision: null,
        detectedFormat: 'SKILL_MD',
        rootName: null,
        skillMarkdown: input.content,
        resources: [],
        notes: [],
      };
    }
    throw new BadRequestException('SKILL_IMPORT_SOURCE_REQUIRED');
  }

  private async fromFile(file: Express.Multer.File): Promise<SkillImportPackage> {
    const fileName = String(file.originalname || 'SKILL.md');
    const lower = fileName.toLowerCase();
    const isZip =
      lower.endsWith('.zip') ||
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed';

    if (isZip) return this.fromZip(fileName, file.buffer);
    if (!/\.(?:md|markdown|txt)$/i.test(lower) && !file.mimetype.startsWith('text/')) {
      throw new BadRequestException('SKILL_IMPORT_FILE_TYPE_UNSUPPORTED');
    }

    const skillMarkdown = file.buffer.toString('utf8');
    if (!skillMarkdown.length) throw new BadRequestException('SKILL_IMPORT_FILE_EMPTY');
    if (!this.looksLikeSkillMarkdown(skillMarkdown)) {
      throw new BadRequestException('SKILL_IMPORT_STANDARD_DOCUMENT_REQUIRED');
    }

    return {
      sourceKind: SkillSourceKind.UPLOAD,
      sourceRef: fileName,
      sourceRevision: null,
      detectedFormat: 'SKILL_MD',
      rootName: null,
      skillMarkdown,
      resources: [],
      notes: [],
    };
  }

  private async fromZip(fileName: string, buffer: Buffer): Promise<SkillImportPackage> {
    try {
      inspectZipCentralDirectory(buffer, {
        maxEntries: SKILL_PACKAGE_LIMITS.maxArchiveEntries,
        maxCentralDirectoryBytes: 16 * 1024 * 1024,
        maxEntryUncompressedBytes: SKILL_PACKAGE_LIMITS.maxArchiveEntryBytes,
        maxTotalUncompressedBytes: SKILL_PACKAGE_LIMITS.maxArchiveUncompressedBytes,
        maxCompressionRatio: 500,
        rejectEncrypted: true,
        rejectUnsafePaths: true,
      });
    } catch (error) {
      if (error instanceof ZipContainerError) {
        throw new BadRequestException({ code: 'SKILL_IMPORT_ZIP_INVALID', message: 'SKILL_IMPORT_ZIP_INVALID', params: { reason: error.code } });
      }
      throw error;
    }

    let archive: Awaited<ReturnType<typeof JSZip.loadAsync>>;
    try {
      archive = await JSZip.loadAsync(buffer);
    } catch {
      throw new BadRequestException('SKILL_IMPORT_ZIP_INVALID');
    }

    const entries = Object.values(archive.files).filter(
      (entry) => !entry.dir && !this.isIgnoredArchivePath(entry.name),
    );
    for (const entry of entries) {
      if (this.isSymbolicLink(entry)) {
        throw new BadRequestException({
          code: 'SKILL_IMPORT_SYMBOLIC_LINK_BLOCKED',
          path: entry.name,
        });
      }
    }

    const skillEntries = entries.filter(
      (entry) => path.posix.basename(entry.name).toLowerCase() === 'skill.md',
    );
    if (skillEntries.length === 0) {
      throw new BadRequestException('SKILL_IMPORT_SKILL_MD_NOT_FOUND');
    }
    if (skillEntries.length !== 1) {
      throw new BadRequestException({
        code: 'SKILL_IMPORT_MULTIPLE_SKILLS_FOUND',
        candidates: skillEntries.slice(0, 50).map((entry) => entry.name),
      });
    }

    const skillEntry = skillEntries[0];
    const root = path.posix.dirname(skillEntry.name) === '.'
      ? ''
      : path.posix.dirname(skillEntry.name).replace(/\/$/, '');
    const rootName = root ? path.posix.basename(root) : null;
    const skillMarkdown = await skillEntry.async('string');
    if (!skillMarkdown.length) throw new BadRequestException('SKILL_IMPORT_FILE_EMPTY');

    const resources: SkillImportPackage['resources'] = [];
    const seen = new Set<string>();
    let totalBytes = Buffer.byteLength(skillMarkdown, 'utf8');

    for (const entry of entries) {
      if (entry.name === skillEntry.name) continue;
      if (root && !entry.name.startsWith(`${root}/`)) continue;
      const relative = root ? entry.name.slice(root.length + 1) : entry.name;
      if (!relative) continue;
      const normalizedPath = this.paths.normalize(relative);
      const collisionKey = normalizedPath.toLocaleLowerCase('en-US');
      if (seen.has(collisionKey)) {
        throw new BadRequestException({
          code: 'SKILL_DUPLICATE_PATH',
          path: normalizedPath,
        });
      }
      seen.add(collisionKey);

      const data = await entry.async('nodebuffer');
      totalBytes += data.byteLength;
      if (resources.length + 1 > SKILL_PACKAGE_LIMITS.maxFiles) {
        throw new BadRequestException('SKILL_IMPORT_FILE_COUNT_EXCEEDED');
      }
      if (totalBytes > SKILL_PACKAGE_LIMITS.maxPackageBytes) {
        throw new BadRequestException('SKILL_IMPORT_PACKAGE_LIMIT_EXCEEDED');
      }
      resources.push({
        path: normalizedPath,
        mimeType: this.mimeType(normalizedPath),
        buffer: data,
      });
    }

    return {
      sourceKind: SkillSourceKind.UPLOAD,
      sourceRef: fileName,
      sourceRevision: null,
      detectedFormat: 'ZIP',
      rootName,
      skillMarkdown,
      resources,
      notes: [],
    };
  }

  private async fromGithub(repositoryUrl: string): Promise<SkillImportPackage> {
    const locator = this.githubLocator(repositoryUrl);
    const metadata = await this.fetchJson(
      `https://api.github.com/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`,
    );
    const ref = locator.ref || this.text(metadata.default_branch) || 'main';
    const tree = await this.fetchJson(
      `https://api.github.com/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    const rows = Array.isArray(tree.tree) ? tree.tree : [];
    const blobs = rows
      .map((item) => this.record(item))
      .filter((item) => item.type === 'blob' && this.text(item.path));

    const requested = locator.requestedPath.replace(/^\/+|\/+$/g, '');
    const directSkillPath = requested.toLowerCase().endsWith('skill.md')
      ? requested
      : '';
    const requestedFolder = directSkillPath
      ? path.posix.dirname(directSkillPath)
      : requested;
    const allCandidates = blobs
      .map((item) => this.text(item.path)!)
      .filter((itemPath) => path.posix.basename(itemPath).toLowerCase() === 'skill.md');

    let candidates = allCandidates;
    if (requestedFolder) {
      const exact = `${requestedFolder}/SKILL.md`.replace(/^\.\//, '');
      candidates = allCandidates.filter(
        (itemPath) => itemPath === exact || itemPath === directSkillPath,
      );
    }
    if (candidates.length === 0) {
      throw new BadRequestException('SKILL_IMPORT_GITHUB_SKILL_MD_NOT_FOUND');
    }
    if (candidates.length !== 1) {
      throw new BadRequestException({
        code: 'SKILL_IMPORT_MULTIPLE_SKILLS_FOUND',
        candidates: candidates.slice(0, 50),
      });
    }

    const skillPath = candidates[0];
    const root = path.posix.dirname(skillPath) === '.'
      ? ''
      : path.posix.dirname(skillPath);
    const rootName = root ? path.posix.basename(root) : null;
    const scoped = blobs
      .filter((item) => {
        const itemPath = this.text(item.path)!;
        return itemPath === skillPath || (root ? itemPath.startsWith(`${root}/`) : true);
      })
      .sort((left, right) => this.text(left.path)!.localeCompare(this.text(right.path)!));

    const resources: SkillImportPackage['resources'] = [];
    const seen = new Set<string>();
    let skillMarkdown = '';
    let totalBytes = 0;

    for (const item of scoped) {
      const absolutePath = this.text(item.path)!;
      const relative = root ? absolutePath.slice(root.length + 1) : absolutePath;
      const declaredSize = Number(item.size ?? 0);
      if (Number.isFinite(declaredSize) && declaredSize > SKILL_PACKAGE_LIMITS.maxArchiveEntryBytes) {
        throw new BadRequestException({
          code: 'SKILL_IMPORT_FILE_SIZE_EXCEEDED',
          path: relative,
        });
      }
      const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}/${encodeURIComponent(ref)}/${absolutePath
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')}`;
      const data = await this.fetchBuffer(rawUrl);
      totalBytes += data.byteLength;
      if (totalBytes > SKILL_PACKAGE_LIMITS.maxPackageBytes) {
        throw new BadRequestException('SKILL_IMPORT_PACKAGE_LIMIT_EXCEEDED');
      }

      if (absolutePath === skillPath) {
        skillMarkdown = data.toString('utf8');
        continue;
      }

      const normalizedPath = this.paths.normalize(relative);
      const collisionKey = normalizedPath.toLocaleLowerCase('en-US');
      if (seen.has(collisionKey)) {
        throw new BadRequestException({
          code: 'SKILL_DUPLICATE_PATH',
          path: normalizedPath,
        });
      }
      seen.add(collisionKey);
      if (resources.length + 1 > SKILL_PACKAGE_LIMITS.maxFiles) {
        throw new BadRequestException('SKILL_IMPORT_FILE_COUNT_EXCEEDED');
      }
      resources.push({
        path: normalizedPath,
        mimeType: this.mimeType(normalizedPath),
        buffer: data,
      });
    }

    if (!skillMarkdown.length) {
      throw new BadGatewayException('SKILL_IMPORT_GITHUB_SKILL_MD_EMPTY');
    }
    if (tree.truncated === true) {
      throw new BadGatewayException('SKILL_IMPORT_GITHUB_TREE_TRUNCATED');
    }

    return {
      sourceKind: SkillSourceKind.REPOSITORY,
      sourceRef: locator.sourceUrl,
      sourceRevision: ref,
      detectedFormat: 'GITHUB',
      rootName,
      skillMarkdown,
      resources,
      notes: [],
    };
  }

  private githubLocator(value: string): RepositoryLocator {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('SKILL_IMPORT_GITHUB_URL_INVALID');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.username ||
      url.password
    ) {
      throw new BadRequestException('SKILL_IMPORT_GITHUB_URL_UNSUPPORTED');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new BadRequestException('SKILL_IMPORT_GITHUB_URL_INVALID');
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    let ref: string | null = null;
    let requestedPath = '';
    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
      ref = parts[3];
      requestedPath = parts.slice(4).join('/');
    }
    return { owner, repo, ref, requestedPath, sourceUrl: url.toString() };
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await this.fetch(url, 'application/vnd.github+json');
    return this.record(await response.json());
  }

  private async fetchBuffer(url: string): Promise<Buffer> {
    const response = await this.fetch(url, 'application/vnd.github.raw');
    return Buffer.from(await response.arrayBuffer());
  }

  private async fetch(url: string, accept: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const token = String(process.env.GITHUB_TOKEN ?? '').trim();
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: accept,
          'User-Agent': 'Agent-Skill-Importer',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) {
        throw new BadGatewayException(`SKILL_IMPORT_GITHUB_HTTP_${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  private isSymbolicLink(entry: { unixPermissions?: string | number | null }): boolean {
    const permissions = typeof entry.unixPermissions === 'number'
      ? entry.unixPermissions
      : typeof entry.unixPermissions === 'string'
        ? Number.parseInt(entry.unixPermissions, 8)
        : 0;
    return Boolean(permissions && (permissions & 0o170000) === 0o120000);
  }

  private isIgnoredArchivePath(value: string): boolean {
    const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = normalized.split('/').filter(Boolean);
    if (!segments.length) return true;
    const ignored = new Set([
      '__MACOSX',
      '.git',
      'node_modules',
      '.venv',
      'venv',
      'dist',
      'build',
      '.next',
      'coverage',
    ]);
    if (segments.some((segment) => ignored.has(segment))) return true;
    const base = segments[segments.length - 1];
    return base === '.DS_Store' || base.startsWith('._');
  }

  private looksLikeSkillMarkdown(value: string): boolean {
    const source = value.startsWith('\uFEFF') ? value.slice(1) : value;
    return /^---[ \t]*(?:\r\n|\n|\r)/.test(source);
  }

  private mimeType(filePath: string): string {
    const extension = path.posix.extname(filePath).toLowerCase();
    const table: Record<string, string> = {
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.yaml': 'application/yaml',
      '.yml': 'application/yaml',
      '.csv': 'text/csv',
      '.xml': 'application/xml',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.ts': 'text/typescript',
      '.py': 'text/x-python',
      '.sh': 'text/x-shellscript',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
    };
    return table[extension] ?? 'application/octet-stream';
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }

  private text(value: unknown): string | null {
    const result = String(value ?? '').trim();
    return result || null;
  }
}
