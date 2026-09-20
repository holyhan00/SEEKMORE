import { Injectable } from '@nestjs/common';
import type { SkillCatalogEntry, SkillRuntimeSession } from '../domain/skill.types';

@Injectable()
export class SkillConflictResolverService {
  conflict(session: SkillRuntimeSession, candidate: SkillCatalogEntry): SkillCatalogEntry | null {
    const loaded = session.internalCatalog.filter((entry) => session.loadedVersions.has(entry.versionId));
    for (const active of loaded) {
      if (active.id === candidate.id) continue;
      if (candidate.exclusiveGroup && active.exclusiveGroup === candidate.exclusiveGroup) return active;
      if (candidate.conflictKeys.some((key) => active.conflictKeys.includes(key))) return active;
    }
    return null;
  }
}
