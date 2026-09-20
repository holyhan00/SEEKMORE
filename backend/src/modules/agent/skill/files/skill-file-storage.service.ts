import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { SkillFileStoragePort } from './skill-file-storage.port';

@Injectable()
export class SkillFileStorageService implements SkillFileStoragePort {
  private readonly root = path.resolve(process.env.SKILL_STORAGE_ROOT || path.join(process.cwd(), 'storage', 'skills'));

  async save(input: { skillId: string; versionId: string; path: string; buffer: Buffer }): Promise<string> {
    const pathParts = input.path.split('/').map((part) => this.safe(part));
    const fileName = pathParts.pop() ?? 'file';
    const storageKey = [
      this.safe(input.skillId),
      this.safe(input.versionId),
      ...pathParts,
      `${randomUUID()}-${fileName}`,
    ].join('/');
    const absolute = this.resolve(storageKey);
    const temporary = `${absolute}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporary, input.buffer, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, absolute);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return storageKey;
  }

  async read(storageKey: string, maxBytes: number): Promise<Buffer> {
    const absolute = this.resolve(storageKey);
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('SKILL_FILE_READ_LIMIT_EXCEEDED');
    return fs.readFile(absolute);
  }

  async remove(storageKey: string): Promise<void> {
    await fs.rm(this.resolve(storageKey), { force: true });
  }

  private resolve(storageKey: string): string {
    const normalized = String(storageKey ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const absolute = path.resolve(this.root, normalized);
    if (absolute !== this.root && !absolute.startsWith(`${this.root}${path.sep}`)) throw new Error('SKILL_STORAGE_PATH_ESCAPE');
    return absolute;
  }

  private safe(value: string): string {
    const result = String(value ?? '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000]/g, '_').trim();
    if (!result || result === '.' || result === '..') throw new Error('SKILL_STORAGE_PART_INVALID');
    return result.slice(0, 180);
  }
}
