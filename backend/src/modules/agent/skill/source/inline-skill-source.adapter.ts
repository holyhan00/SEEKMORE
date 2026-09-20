import { Injectable } from '@nestjs/common';
import { SkillSourceKind } from '@prisma/client';
import type { SkillSourceAdapter, SkillSourceDescriptor } from './skill-source-adapter';

@Injectable()
export class InlineSkillSourceAdapter implements SkillSourceAdapter {
  readonly kind = SkillSourceKind.INLINE;
  normalize(input: SkillSourceDescriptor): SkillSourceDescriptor {
    return { ...input, kind: this.kind, sourceRef: null, sourceRevision: null, lockData: {} };
  }
}
