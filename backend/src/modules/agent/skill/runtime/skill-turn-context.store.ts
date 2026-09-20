import { Injectable } from '@nestjs/common';
import type { SkillCatalogEntry, SkillRuntimeSession, SkillTurnPreparedContext } from '../domain/skill.types';

@Injectable()
export class SkillTurnContextStore {
  private readonly sessions = new Map<string, SkillRuntimeSession>();

  set(context: SkillTurnPreparedContext): void {
    this.sessions.set(context.traceId, {
      ...context,
      allowedVersions: new Map(
        context.internalCatalog.map((entry) => [entry.id, entry.versionId]),
      ),
      allowedSkillIdsByName: new Map(
        context.internalCatalog.map((entry) => [entry.name, entry.id]),
      ),
      loadedVersions: new Set(
        context.preloadedSkills.flatMap((skill) =>
          context.internalCatalog
            .filter((entry) => entry.name === skill.name)
            .map((entry) => entry.versionId),
        ),
      ),
      resourceReads: 0,
      resourceTokens: 0,
      automaticLoads: 0,
    });
  }

  get(traceId: string | undefined): SkillRuntimeSession | null {
    return traceId ? this.sessions.get(traceId) ?? null : null;
  }

  allowSkillLoad(traceId: string, skillName: string): boolean {
    const session = this.sessions.get(traceId);
    if (!session) return false;
    const entry = session.internalCatalog.find((item) => item.name === skillName);
    if (!entry) return false;
    if (entry.activationMode !== 'AUTOMATIC') return true;
    if (session.loadedVersions.has(entry.versionId)) return true;
    return session.automaticLoads < session.policy.maxAutomaticSkills;
  }

  appendCandidates(traceId: string, entries: SkillCatalogEntry[]): SkillCatalogEntry[] {
    const session = this.sessions.get(traceId);
    if (!session) return [];
    const appended: SkillCatalogEntry[] = [];
    let characters = JSON.stringify(session.catalog).length;
    for (const entry of entries) {
      if (session.internalCatalog.length >= session.policy.maxCatalogEntries) break;
      if (session.internalCatalog.some((item) => item.id === entry.id || item.name === entry.name)) continue;
      const discovery = {
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
      };
      const size = JSON.stringify(discovery).length;
      if (characters + size > session.policy.catalogCharBudget) break;
      session.internalCatalog.push(entry);
      session.catalog.push(discovery);
      session.allowedVersions.set(entry.id, entry.versionId);
      session.allowedSkillIdsByName.set(entry.name, entry.id);
      characters += size;
      appended.push(entry);
    }
    return appended;
  }

  markLoaded(traceId: string, skillName: string, versionId: string): void {
    const session = this.sessions.get(traceId);
    if (!session) return;
    const skillId = session.allowedSkillIdsByName.get(skillName);
    if (!skillId || session.allowedVersions.get(skillId) !== versionId) return;
    const entry = session.internalCatalog.find((item) => item.id === skillId);
    const alreadyLoaded = session.loadedVersions.has(versionId);
    session.loadedVersions.add(versionId);
    if (!alreadyLoaded && entry?.activationMode === 'AUTOMATIC') {
      session.automaticLoads += 1;
    }
  }

  consumeResource(traceId: string, versionId: string, tokenEstimate: number): boolean {
    const session = this.sessions.get(traceId);
    if (!session || !session.loadedVersions.has(versionId)) return false;
    if (session.resourceReads + 1 > session.policy.maxResourceFiles) return false;
    if (session.resourceTokens + tokenEstimate > session.policy.resourceTokenBudget) return false;
    session.resourceReads += 1;
    session.resourceTokens += tokenEstimate;
    return true;
  }

  clear(traceId: string): void {
    this.sessions.delete(traceId);
  }
}
