import { Injectable } from '@nestjs/common';
import type {
  SkillCatalogEntry,
  SkillDiscoveryEntry,
  SkillRuntimePolicy,
} from '../domain/skill.types';

@Injectable()
export class SkillCatalogBuilder {
  build(
    associated: SkillCatalogEntry[],
    discoverable: SkillCatalogEntry[],
    policy: SkillRuntimePolicy,
  ): { internalCatalog: SkillCatalogEntry[]; discoveryCatalog: SkillDiscoveryEntry[] } {
    const internalCatalog: SkillCatalogEntry[] = [];
    const discoveryCatalog: SkillDiscoveryEntry[] = [];
    let characters = 0;

    const append = (entry: SkillCatalogEntry): boolean => {
      if (internalCatalog.length >= policy.maxCatalogEntries) return false;
      if (internalCatalog.some((item) => item.id === entry.id || item.name === entry.name)) return true;
      const discovery = {
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
      };
      const size = JSON.stringify(discovery).length;
      if (characters + size > policy.catalogCharBudget) return false;
      internalCatalog.push(entry);
      discoveryCatalog.push(discovery);
      characters += size;
      return true;
    };

    for (const entry of [...associated].sort(this.associatedOrder)) append(entry);
    for (const entry of [...discoverable].sort(this.discoverableOrder)) append(entry);

    return { internalCatalog, discoveryCatalog };
  }

  private associatedOrder(left: SkillCatalogEntry, right: SkillCatalogEntry): number {
    const sourceRank = (source: SkillCatalogEntry['source']) =>
      source === 'USER_EXPLICIT'
        ? 3
        : source === 'SESSION'
          ? 2
          : source === 'AGENT_BINDING'
            ? 1
            : 0;
    const priorityOrder =
      left.source === 'AGENT_BINDING' && right.source === 'AGENT_BINDING'
        ? left.priority - right.priority
        : right.priority - left.priority;
    return (
      sourceRank(right.source) - sourceRank(left.source) ||
      priorityOrder ||
      left.displayName.localeCompare(right.displayName)
    );
  }

  private discoverableOrder(left: SkillCatalogEntry, right: SkillCatalogEntry): number {
    return (
      right.relevance - left.relevance ||
      right.priority - left.priority ||
      left.displayName.localeCompare(right.displayName)
    );
  }
}
