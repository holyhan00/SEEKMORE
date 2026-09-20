import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSeekmoreDataHome } from '../seekmore-data-home';

type StoredSecret = {
  installationId: string;
  encryptedBase64: string;
  updatedAt: string;
};

type StoredSecretFile = {
  secrets: Record<string, StoredSecret>;
};

export class DesktopMcpSecretStore {
  async put(
    installationId: string,
    values: Record<string, string>,
  ): Promise<{ secretRef: string }> {
    const cleanInstallationId = this.requiredId(installationId);
    const entries = Object.entries(values ?? {});
    if (entries.length === 0 || entries.length > 64) {
      throw this.error('MCP_SECRET_INVALID', 'MCP secret values are invalid.');
    }
    const cleanValues: Record<string, string> = {};
    for (const [rawKey, rawValue] of entries) {
      const key = String(rawKey ?? '').trim();
      const value = String(rawValue ?? '');
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)
        || !value
        || Buffer.byteLength(value, 'utf8') > 16 * 1024
        || /\0/.test(value)) {
        throw this.error('MCP_SECRET_INVALID', 'MCP secret values are invalid.');
      }
      cleanValues[key] = value;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw this.error(
        'MCP_SAFE_STORAGE_UNAVAILABLE',
        'Electron safeStorage is unavailable on this device.',
      );
    }

    const file = await this.readStore();
    for (const [secretRef, record] of Object.entries(file.secrets)) {
      if (record.installationId === cleanInstallationId) {
        delete file.secrets[secretRef];
      }
    }
    const secretRef = `mcp_secret_${randomUUID()}`;
    const encrypted = safeStorage.encryptString(JSON.stringify(cleanValues));
    file.secrets[secretRef] = {
      installationId: cleanInstallationId,
      encryptedBase64: encrypted.toString('base64'),
      updatedAt: new Date().toISOString(),
    };
    await this.writeStore(file);
    return { secretRef };
  }

  async resolve(
    installationId: string,
    secretRef: string | null | undefined,
  ): Promise<Record<string, string>> {
    if (!secretRef) return {};
    if (!safeStorage.isEncryptionAvailable()) {
      throw this.error(
        'MCP_SAFE_STORAGE_UNAVAILABLE',
        'Electron safeStorage is unavailable on this device.',
      );
    }
    const file = await this.readStore();
    const record = file.secrets[secretRef];
    if (!record || record.installationId !== installationId) {
      throw this.error('MCP_SECRET_NOT_FOUND', 'MCP secret reference is invalid.');
    }
    const plaintext = safeStorage.decryptString(
      Buffer.from(record.encryptedBase64, 'base64'),
    );
    const parsed = JSON.parse(plaintext) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw this.error('MCP_SECRET_INVALID', 'Stored MCP secret is invalid.');
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
  }

  async deleteForInstallation(installationId: string): Promise<void> {
    const file = await this.readStore();
    let changed = false;
    for (const [secretRef, record] of Object.entries(file.secrets)) {
      if (record.installationId === installationId) {
        delete file.secrets[secretRef];
        changed = true;
      }
    }
    if (changed) await this.writeStore(file);
  }

  private async readStore(): Promise<StoredSecretFile> {
    try {
      const raw = JSON.parse(await readFile(this.filePath(), 'utf8')) as StoredSecretFile;
      if (raw?.secrets && typeof raw.secrets === 'object') {
        return { secrets: raw.secrets };
      }
    } catch {
                                                                         
    }
    return { secrets: {} };
  }

  private async writeStore(value: StoredSecretFile): Promise<void> {
    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await rename(temporary, filePath);
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      await unlink(filePath).catch(() => undefined);
      await rename(temporary, filePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private filePath(): string {
    return path.join(resolveSeekmoreDataHome(app), 'secrets', 'mcp-secrets.json');
  }

  private requiredId(value: string): string {
    const id = String(value ?? '').trim();
    if (!id || id.length > 200 || /[\r\n\0]/.test(id)) {
      throw this.error('MCP_INSTALLATION_ID_INVALID', 'Invalid MCP installation id.');
    }
    return id;
  }

  private error(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
  }
}
