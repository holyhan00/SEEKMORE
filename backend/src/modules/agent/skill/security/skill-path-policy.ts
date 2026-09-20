import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { SkillDomainError } from '../domain/skill.errors';
import { SKILL_PACKAGE_LIMITS } from '../domain/skill-policy';

@Injectable()
export class SkillPathPolicy {
  normalize(rawPath: string): string {
    const input = String(rawPath ?? '').normalize('NFKC').replace(/\\/g, '/').trim();
    if (!input || input.includes('\u0000')) throw new SkillDomainError('SKILL_PATH_INVALID', 'Skill file path is invalid.');
    if (path.posix.isAbsolute(input) || /^[A-Za-z]:\//.test(input)) {
      throw new SkillDomainError('SKILL_PATH_ABSOLUTE', 'Skill files cannot use absolute paths.');
    }
    const normalized = path.posix.normalize(input).replace(/^\.\//, '');
    const segments = normalized.split('/');
    if (normalized === '..' || normalized.startsWith('../') || segments.includes('..')) {
      throw new SkillDomainError('SKILL_PATH_TRAVERSAL', 'Skill file path cannot traverse outside the Skill root.');
    }
    if (segments.some((segment) => !segment || segment === '.')) {
      throw new SkillDomainError('SKILL_PATH_SEGMENT_INVALID', 'Skill file path contains an invalid segment.');
    }
    if (segments.some((segment) => segment.startsWith('.'))) {
      throw new SkillDomainError('SKILL_PATH_HIDDEN_SEGMENT', 'Skill file path cannot contain hidden files or directories.');
    }
    if (segments.length > SKILL_PACKAGE_LIMITS.maxDepth) {
      throw new SkillDomainError('SKILL_PATH_DEPTH_EXCEEDED', 'Skill file path exceeds the maximum directory depth.');
    }
    if (normalized.length > 500) throw new SkillDomainError('SKILL_PATH_TOO_LONG', 'Skill file path is too long.');
    return normalized;
  }

  classify(normalizedPath: string): 'REFERENCE' | 'SCRIPT' | 'ASSET' | 'LICENSE' | 'OTHER' {
    const lower = normalizedPath.toLowerCase();
    if (lower === 'license' || lower.startsWith('license.')) return 'LICENSE';
    if (lower.startsWith('references/')) return 'REFERENCE';
    if (lower.startsWith('scripts/')) return 'SCRIPT';
    if (lower.startsWith('assets/')) return 'ASSET';
    return 'OTHER';
  }
}
