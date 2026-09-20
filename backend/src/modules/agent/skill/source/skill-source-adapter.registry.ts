import { Injectable } from '@nestjs/common';
import type { SkillSourceKind } from '@prisma/client';
import { InlineSkillSourceAdapter } from './inline-skill-source.adapter';
import { UploadSkillSourceAdapter } from './upload-skill-source.adapter';
import { RepositorySkillSourceAdapter } from './repository-skill-source.adapter';
import { ImportedSkillSourceAdapter } from './imported-skill-source.adapter';
import { BuiltinSkillSourceAdapter } from './builtin-skill-source.adapter';
import type { SkillSourceAdapter, SkillSourceDescriptor } from './skill-source-adapter';

@Injectable()
export class SkillSourceAdapterRegistry {
  private readonly adapters: ReadonlyMap<SkillSourceKind, SkillSourceAdapter>;

  constructor(
    inline: InlineSkillSourceAdapter,
    upload: UploadSkillSourceAdapter,
    repository: RepositorySkillSourceAdapter,
    imported: ImportedSkillSourceAdapter,
    builtin: BuiltinSkillSourceAdapter,
  ) {
    this.adapters = new Map([inline, upload, repository, imported, builtin].map((adapter) => [adapter.kind, adapter]));
  }

  normalize(input: SkillSourceDescriptor): SkillSourceDescriptor {
    const adapter = this.adapters.get(input.kind);
    if (!adapter) throw new Error(`SKILL_SOURCE_ADAPTER_NOT_REGISTERED:${input.kind}`);
    return adapter.normalize(input);
  }
}
