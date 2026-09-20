import { BadRequestException, Injectable } from '@nestjs/common';
import { SkillSourceKind } from '@prisma/client';
import type { SkillSourceAdapter, SkillSourceDescriptor } from './skill-source-adapter';

@Injectable()
export class BuiltinSkillSourceAdapter implements SkillSourceAdapter {
  readonly kind = SkillSourceKind.BUILTIN;
  normalize(_input: SkillSourceDescriptor): SkillSourceDescriptor {
    throw new BadRequestException('BUILTIN_SKILL_SOURCE_CANNOT_BE_CREATED_OR_CHANGED_BY_USER');
  }
}
