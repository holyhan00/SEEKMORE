import { Injectable } from '@nestjs/common';
import { SkillSourceKind } from '@prisma/client';
import type { SkillSourceAdapter, SkillSourceDescriptor } from './skill-source-adapter';

@Injectable()
export class ImportedSkillSourceAdapter implements SkillSourceAdapter {
  readonly kind = SkillSourceKind.IMPORTED;
  normalize(input: SkillSourceDescriptor): SkillSourceDescriptor {
    return { ...input, kind: this.kind, sourceRef: input.sourceRef?.trim() || null };
  }
}
