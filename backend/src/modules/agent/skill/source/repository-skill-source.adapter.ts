import { BadRequestException, Injectable } from '@nestjs/common';
import { SkillSourceKind } from '@prisma/client';
import type { SkillSourceAdapter, SkillSourceDescriptor } from './skill-source-adapter';

@Injectable()
export class RepositorySkillSourceAdapter implements SkillSourceAdapter {
  readonly kind = SkillSourceKind.REPOSITORY;
  normalize(input: SkillSourceDescriptor): SkillSourceDescriptor {
    const sourceRef = input.sourceRef?.trim();
    if (!sourceRef) throw new BadRequestException('REPOSITORY_SKILL_SOURCE_REF_REQUIRED');
    let url: URL;
    try { url = new URL(sourceRef); } catch { throw new BadRequestException('REPOSITORY_SKILL_SOURCE_URL_INVALID'); }
    if (url.protocol !== 'https:') throw new BadRequestException('REPOSITORY_SKILL_SOURCE_HTTPS_REQUIRED');
    if (url.username || url.password) throw new BadRequestException('REPOSITORY_SKILL_SOURCE_CREDENTIALS_FORBIDDEN');
    return { ...input, kind: this.kind, sourceRef: url.toString(), sourceRevision: input.sourceRevision?.trim() || null };
  }
}
