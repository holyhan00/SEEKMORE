import type { JsonObject } from '../domain/skill.types';
import type { SkillSourceKind } from '@prisma/client';

export interface SkillSourceDescriptor {
  kind: SkillSourceKind;
  sourceRef: string | null;
  sourceRevision: string | null;
  provenance: JsonObject;
  lockData: JsonObject;
  checksum: string | null;
}

export interface SkillSourceAdapter {
  readonly kind: SkillSourceKind;
  normalize(input: SkillSourceDescriptor): SkillSourceDescriptor;
}
