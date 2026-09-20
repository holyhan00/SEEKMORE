export const SKILL_FILE_STORAGE = Symbol('SKILL_FILE_STORAGE');

export interface SkillFileStoragePort {
  save(input: { skillId: string; versionId: string; path: string; buffer: Buffer }): Promise<string>;
  read(storageKey: string, maxBytes: number): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}
