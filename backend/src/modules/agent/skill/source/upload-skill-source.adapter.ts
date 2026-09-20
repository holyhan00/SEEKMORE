import { BadRequestException, Injectable } from '@nestjs/common';
import { SkillSourceKind } from '@prisma/client';
import type { SkillSourceAdapter, SkillSourceDescriptor } from './skill-source-adapter';

@Injectable()
export class UploadSkillSourceAdapter implements SkillSourceAdapter {
  readonly kind = SkillSourceKind.UPLOAD;
  normalize(input: SkillSourceDescriptor): SkillSourceDescriptor {
    if (!input.checksum) throw new BadRequestException('UPLOADED_SKILL_SOURCE_CHECKSUM_REQUIRED');
    return { ...input, kind: this.kind, sourceRef: input.sourceRef?.trim() || null };
  }
}
