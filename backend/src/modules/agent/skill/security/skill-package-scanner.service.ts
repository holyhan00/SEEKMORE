import { Injectable } from '@nestjs/common';
import { SKILL_PACKAGE_LIMITS } from '../domain/skill-policy';
import type { SkillValidationIssue } from '../domain/skill.types';

export interface ScannableSkillFile {
  path: string;
  sizeBytes: number;
  mimeType: string;
  fileType: 'REFERENCE' | 'SCRIPT' | 'ASSET' | 'LICENSE' | 'OTHER';
  textContent?: string | null;
}

@Injectable()
export class SkillPackageScannerService {
  scan(skillMarkdown: string, files: ScannableSkillFile[]): SkillValidationIssue[] {
    const issues: SkillValidationIssue[] = [];
    const totalBytes = Buffer.byteLength(skillMarkdown, 'utf8') + files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (files.length > SKILL_PACKAGE_LIMITS.maxFiles) issues.push(this.issue('SKILL_FILE_COUNT_EXCEEDED', 'ERROR', null, 'Skill file count exceeds the configured limit.', { maxFiles: SKILL_PACKAGE_LIMITS.maxFiles }));
    if (totalBytes > SKILL_PACKAGE_LIMITS.maxPackageBytes) issues.push(this.issue('SKILL_PACKAGE_SIZE_EXCEEDED', 'ERROR', null, 'Skill package size exceeds the configured limit.', { maxBytes: SKILL_PACKAGE_LIMITS.maxPackageBytes }));
    if (Buffer.byteLength(skillMarkdown, 'utf8') > SKILL_PACKAGE_LIMITS.maxSkillMarkdownBytes) issues.push(this.issue('SKILL_MARKDOWN_SIZE_EXCEEDED', 'ERROR', 'SKILL.md', 'SKILL.md exceeds the configured safety size limit.', { maxBytes: SKILL_PACKAGE_LIMITS.maxSkillMarkdownBytes }));

    this.scanText('SKILL.md', skillMarkdown, issues);
    const seen = new Set<string>();
    for (const file of files) {
      if (seen.has(file.path)) issues.push(this.issue('SKILL_DUPLICATE_PATH', 'ERROR', file.path, 'The Skill package contains a duplicate file path.', { path: file.path }));
      seen.add(file.path);
      const limit = file.fileType === 'REFERENCE'
        ? SKILL_PACKAGE_LIMITS.maxReferenceBytes
        : file.fileType === 'SCRIPT'
          ? SKILL_PACKAGE_LIMITS.maxScriptBytes
          : file.fileType === 'ASSET'
            ? SKILL_PACKAGE_LIMITS.maxAssetBytes
            : SKILL_PACKAGE_LIMITS.maxReferenceBytes;
      if (file.sizeBytes > limit) issues.push(this.issue('SKILL_FILE_SIZE_EXCEEDED', 'ERROR', file.path, 'Skill file size exceeds the limit for this file type.', { path: file.path, maxBytes: limit }));
      if (file.textContent) this.scanText(file.path, file.textContent, issues);
    }
    return issues;
  }

  private scanText(path: string, content: string, issues: SkillValidationIssue[]): void {
    const checks: Array<[RegExp, string, 'WARNING' | 'ERROR' | 'CRITICAL', string]> = [
      [/\bcurl\b[^\n|]{0,300}\|\s*(?:sh|bash|zsh)\b/i, 'SKILL_PIPE_REMOTE_SHELL', 'CRITICAL', 'Detected a remote download piped directly into a shell.'],
      [/\bwget\b[^\n|]{0,300}\|\s*(?:sh|bash|zsh)\b/i, 'SKILL_PIPE_REMOTE_SHELL', 'CRITICAL', 'Detected a remote download piped directly into a shell.'],
      [/\b(?:sudo|su\s+-|chmod\s+777|rm\s+-rf\s+\/)\b/i, 'SKILL_PRIVILEGED_COMMAND', 'CRITICAL', 'Detected a high-risk system command.'],
      [/(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16})/, 'SKILL_SECRET_MATERIAL', 'CRITICAL', 'Detected possible credentials or private key material.'],
      [/[\u202A-\u202E\u2066-\u2069]/u, 'SKILL_BIDI_CONTROL', 'ERROR', 'Detected bidirectional text control characters.'],
      [/[\u200B-\u200D\uFEFF]/u, 'SKILL_ZERO_WIDTH', 'WARNING', 'Detected zero-width characters.'],
      [/<!--[^]*?(?:ignore|override|system prompt|secret|隐藏)[^]*?-->/i, 'SKILL_HIDDEN_INSTRUCTION', 'ERROR', 'Detected hidden instructions inside an HTML comment.'],
      [/data:text\/html;base64,/i, 'SKILL_DATA_URL', 'ERROR', 'Detected an inline executable data URL.'],
    ];
    for (const [pattern, code, severity, message] of checks) {
      if (pattern.test(content)) issues.push(this.issue(code, severity, path, message));
    }
  }

  private issue(
    code: string,
    severity: SkillValidationIssue['severity'],
    path: string | null,
    message: string,
    params?: Record<string, string | number | boolean | null>,
  ): SkillValidationIssue {
    return { code, severity, path, message, ...(params ? { params } : {}) };
  }
}
