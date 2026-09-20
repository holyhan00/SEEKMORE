import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, type ReadStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface RuntimeObjectStoredObject {
  storageKey: string;
  sizeBytes: number;
  contentHash: string;
}

@Injectable()
export class RuntimeObjectStorageService {
  private readonly root = path.resolve(
    process.env.OBJECT_STORAGE_ROOT || path.join(process.cwd(), 'storage', 'objects'),
  );

  async saveOriginal(input: {
    userId: string;
    agentId: string;
    conversationId: string;
    objectId: string;
    originalName: string;
    buffer: Buffer;
  }): Promise<RuntimeObjectStoredObject> {
    const extension = path.extname(input.originalName).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24);
    const storageKey = [
      this.safePathPart(input.userId),
      this.safePathPart(input.agentId),
      this.safePathPart(input.conversationId),
      this.safePathPart(input.objectId),
      'original',
      `original${extension}`,
    ].join('/');

    const absolutePath = this.resolveStorageKey(storageKey);
    const directory = path.dirname(absolutePath);
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;

    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporaryPath, input.buffer, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporaryPath, absolutePath);
      await fs.chmod(absolutePath, 0o600);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      storageKey,
      sizeBytes: input.buffer.byteLength,
      contentHash: createHash('sha256').update(input.buffer).digest('hex'),
    };
  }

  async savePreview(input: {
    userId: string;
    agentId: string;
    conversationId: string;
    objectId: string;
    extension: string;
    buffer: Buffer;
  }): Promise<RuntimeObjectStoredObject> {
    const extension = String(input.extension ?? '')
      .toLowerCase()
      .replace(/^\.+/, '')
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24) || 'bin';
    const storageKey = [
      this.safePathPart(input.userId),
      this.safePathPart(input.agentId),
      this.safePathPart(input.conversationId),
      this.safePathPart(input.objectId),
      'preview',
      `preview.${extension}`,
    ].join('/');

    const absolutePath = this.resolveStorageKey(storageKey);
    const directory = path.dirname(absolutePath);
    const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;

    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporaryPath, input.buffer, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporaryPath, absolutePath);
      await fs.chmod(absolutePath, 0o600);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      storageKey,
      sizeBytes: input.buffer.byteLength,
      contentHash: createHash('sha256').update(input.buffer).digest('hex'),
    };
  }

  createReadStream(storageKey: string): ReadStream {
    return createReadStream(this.resolveStorageKey(storageKey));
  }

  async stat(storageKey: string): Promise<{ sizeBytes: number }> {
    const stat = await fs.stat(this.resolveStorageKey(storageKey));
    if (!stat.isFile()) throw new Error('OBJECT_STORAGE_NOT_A_FILE');
    return { sizeBytes: stat.size };
  }

  async readBuffer(storageKey: string, maxBytes: number): Promise<Buffer> {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('OBJECT_STORAGE_READ_LIMIT_INVALID');
    const absolutePath = this.resolveStorageKey(storageKey);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw new Error('OBJECT_STORAGE_NOT_A_FILE');
    if (stat.size > maxBytes) throw new Error('OBJECT_STORAGE_READ_LIMIT_EXCEEDED');
    return fs.readFile(absolutePath);
  }

  async remove(storageKey: string): Promise<void> {
    const absolutePath = this.resolveStorageKey(storageKey);
    await fs.rm(path.dirname(path.dirname(absolutePath)), { recursive: true, force: true });
  }

  resolveStorageKey(storageKey: string): string {
    const normalized = String(storageKey ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('\u0000')) throw new Error('OBJECT_STORAGE_KEY_INVALID');

    const absolutePath = path.resolve(this.root, normalized);
    if (absolutePath !== this.root && !absolutePath.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('OBJECT_STORAGE_PATH_ESCAPE');
    }
    return absolutePath;
  }

  private safePathPart(value: string): string {
    const safe = String(value ?? '')
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|\u0000]/g, '_')
      .trim()
      .slice(0, 160);
    if (!safe || safe === '.' || safe === '..') throw new Error('OBJECT_STORAGE_PARTITION_INVALID');
    return safe;
  }
}
