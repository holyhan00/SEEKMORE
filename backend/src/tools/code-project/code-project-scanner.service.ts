import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { ArchiveManifest } from './archive-manifest.types';
import type { CodeProjectKind, CodeProjectScanFile } from './code-project.types';

@Injectable()
export class CodeProjectScannerService {
  private readonly maxFileChars = Number(process.env.CODE_PROJECT_MAX_FILE_CHARS ?? 300_000);
  private readonly maxObjects = Number(process.env.CODE_PROJECT_MAX_FILES ?? 1500);

  async scan(input: { extractedRoot: string; manifest: ArchiveManifest }): Promise<{ objects: CodeProjectScanFile[]; projectKind: CodeProjectKind; languageSet: string[]; warnings: string[] }> {
    const codeEntries = input.manifest.entries
      .filter((entry) => !entry.ignored && entry.safe && entry.objectKind === 'code')
      .slice(0, this.maxObjects);
    const warnings: string[] = [];
    if (codeEntries.length >= this.maxObjects) warnings.push('code_project_file_limit_reached');

    const objects: CodeProjectScanFile[] = [];
    for (const entry of codeEntries) {
      const abs = path.join(input.extractedRoot, entry.normalizedPath);
      const content = await fs.readFile(abs, 'utf8').catch(() => '');
      const truncated = content.length > this.maxFileChars;
      if (truncated) warnings.push(`code_file_truncated:${entry.normalizedPath}`);
      const safeContent = truncated ? content.slice(0, this.maxFileChars) : content;
      objects.push({
        path: entry.normalizedPath,
        language: this.language(entry.normalizedPath),
        role: this.role(entry.normalizedPath),
        sizeBytes: entry.sizeBytes,
        lineCount: safeContent.split(/\r?\n/).length,
        content: safeContent,
        hash: entry.hash ?? null,
      });
    }

    const languageSet = Array.from(new Set(objects.map((file) => file.language).filter(Boolean))).sort();
    return { objects, projectKind: this.projectKind(input.manifest, objects), languageSet, warnings };
  }

  private language(filePath: string): string {
    const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
    const map: Record<string, string> = { ts: 'typescript', tsx: 'typescript-react', js: 'javascript', jsx: 'javascript-react', py: 'python', java: 'java', go: 'go', rs: 'rust', php: 'php', vue: 'vue', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml' };
    return map[ext] ?? (ext || 'unknown');
  }

  private role(filePath: string): CodeProjectScanFile['role'] {
    if (/(^|\/)(package\.json|tsconfig\.json|vite\.config\.|nest-cli\.json|pyproject\.toml|requirements\.txt|pom\.xml|Cargo\.toml|go\.mod)$/i.test(filePath)) return 'manifest';
    if (/\.(spec|test)\.(ts|tsx|js|jsx|py|java)$/i.test(filePath) || /(^|\/)(__tests__|test|tests)(\/|$)/i.test(filePath)) return 'test';
    if (/(^|\/)(README|readme)|\.(md|rst)$/i.test(filePath)) return 'docs';
    if (/(^|\/)(dist|build|generated)(\/|$)/i.test(filePath)) return 'generated';
    if (/\.(json|yaml|yml|xml|toml|config\.(ts|js))$/i.test(filePath)) return 'config';
    return 'source';
  }

  private projectKind(manifest: ArchiveManifest, objects: CodeProjectScanFile[]): CodeProjectKind {
    const paths = new Set(manifest.entries.map((entry) => entry.normalizedPath.toLowerCase()));
    if (paths.has('nest-cli.json') || objects.some((file) => /@nestjs\//.test(file.content))) return 'nestjs';
    if (paths.has('vite.config.ts') || paths.has('vite.config.js')) return 'vite';
    if (objects.some((file) => file.language.includes('react') || /from ['"]react['"]/.test(file.content))) return 'react';
    if (paths.has('package.json')) return 'node';
    if (paths.has('requirements.txt') || paths.has('pyproject.toml')) return 'python';
    if (paths.has('pom.xml') || paths.has('build.gradle')) return 'java';
    if (paths.has('go.mod')) return 'go';
    if (paths.has('cargo.toml')) return 'rust';
    if (paths.has('composer.json')) return 'php';
    return 'unknown';
  }
}
