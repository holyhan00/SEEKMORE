import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SeekmoreRuntimeSecrets } from './runtime.types';

const STORE_VERSION = 2;

type StoredRuntimeSecretFile = {
  version: 1 | 2;
  encryptedBase64: string;
  updatedAt: string;
};

type RuntimeSecretPayloadV1 = {
  version: 1;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  mcpSecretEncryptionKey: string;
};

type RuntimeSecretPayloadV2 = {
  version: 2;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  mcpSecretEncryptionKey: string;
  postgresPassword: string;
  redisPassword: string;
};

type RuntimeSecretPayload = RuntimeSecretPayloadV1 | RuntimeSecretPayloadV2;

export type RuntimeSecretEncryption = {
  isAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export class SeekmoreRuntimeSecretStore {
  constructor(
    private readonly filePath: string,
    private readonly encryption: RuntimeSecretEncryption,
  ) {}

  async loadOrCreate(): Promise<SeekmoreRuntimeSecrets> {
    this.assertEncryptionAvailable();

    try {
      const existing = await this.readExisting();
      if (existing.needsUpgrade) {
        await this.writeStore(existing.secrets);
      }
      return existing.secrets;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    const secrets = createSeekmoreRuntimeSecrets();
    await this.writeStore(secrets);
    return secrets;
  }

  private async readExisting(): Promise<{
    secrets: SeekmoreRuntimeSecrets;
    needsUpgrade: boolean;
  }> {
    let parsed: StoredRuntimeSecretFile;
    try {
      parsed = JSON.parse(
        await readFile(this.filePath, 'utf8'),
      ) as StoredRuntimeSecretFile;
    } catch (error) {
      if (isMissingFileError(error)) throw error;
      throw this.error(
        'RUNTIME_SECRET_STORE_INVALID',
        'SEEKMORE runtime secret store is invalid.',
      );
    }

    if (
      (parsed?.version !== 1 && parsed?.version !== 2)
      || typeof parsed.encryptedBase64 !== 'string'
      || !parsed.encryptedBase64
    ) {
      throw this.error(
        'RUNTIME_SECRET_STORE_INVALID',
        'SEEKMORE runtime secret store is invalid.',
      );
    }

    let payload: RuntimeSecretPayload;
    try {
      payload = JSON.parse(
        this.encryption.decryptString(
          Buffer.from(parsed.encryptedBase64, 'base64'),
        ),
      ) as RuntimeSecretPayload;
    } catch {
      throw this.error(
        'RUNTIME_SECRET_DECRYPT_FAILED',
        'SEEKMORE runtime secrets could not be decrypted.',
      );
    }

    if (payload?.version === 1) {
      const preserved = validateV1Payload(payload);
      return {
        needsUpgrade: true,
        secrets: {
          ...preserved,
          postgresPassword: createPassword(),
          redisPassword: createPassword(),
        },
      };
    }

    return {
      needsUpgrade: parsed.version !== STORE_VERSION,
      secrets: validateV2Payload(payload),
    };
  }

  private async writeStore(secrets: SeekmoreRuntimeSecrets): Promise<void> {
    const payload: RuntimeSecretPayloadV2 = {
      version: STORE_VERSION,
      ...secrets,
    };
    const encrypted = this.encryption.encryptString(
      JSON.stringify(payload),
    );
    const stored: StoredRuntimeSecretFile = {
      version: STORE_VERSION,
      encryptedBase64: encrypted.toString('base64'),
      updatedAt: new Date().toISOString(),
    };

    await mkdir(path.dirname(this.filePath), {
      recursive: true,
      mode: 0o700,
    });

    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await unlink(temporary).catch(() => undefined);
    await writeFile(temporary, JSON.stringify(stored), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });

    try {
      await rename(temporary, this.filePath);
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      await unlink(this.filePath).catch(() => undefined);
      await rename(temporary, this.filePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private assertEncryptionAvailable(): void {
    if (!this.encryption.isAvailable()) {
      throw this.error(
        'RUNTIME_SAFE_STORAGE_UNAVAILABLE',
        'Electron safeStorage is unavailable on this device.',
      );
    }
  }

  private error(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
  }
}

export function createSeekmoreRuntimeSecrets(): SeekmoreRuntimeSecrets {
  return {
    jwtAccessSecret: randomBytes(48).toString('base64url'),
    jwtRefreshSecret: randomBytes(48).toString('base64url'),
    mcpSecretEncryptionKey: randomBytes(32).toString('base64'),
    postgresPassword: createPassword(),
    redisPassword: createPassword(),
  };
}

export const createSeekmoreBackendRuntimeSecrets = createSeekmoreRuntimeSecrets;

function validateV1Payload(
  value: RuntimeSecretPayloadV1,
): Pick<
  SeekmoreRuntimeSecrets,
  'jwtAccessSecret' | 'jwtRefreshSecret' | 'mcpSecretEncryptionKey'
> {
  if (value?.version !== 1) throw invalidPayloadError();
  return validateCoreSecrets(value);
}

function validateV2Payload(value: RuntimeSecretPayload): SeekmoreRuntimeSecrets {
  if (value?.version !== 2) throw invalidPayloadError();
  return {
    ...validateCoreSecrets(value),
    postgresPassword: requiredSecret(value.postgresPassword),
    redisPassword: requiredSecret(value.redisPassword),
  };
}

function validateCoreSecrets(value: {
  jwtAccessSecret: unknown;
  jwtRefreshSecret: unknown;
  mcpSecretEncryptionKey: unknown;
}): Pick<
  SeekmoreRuntimeSecrets,
  'jwtAccessSecret' | 'jwtRefreshSecret' | 'mcpSecretEncryptionKey'
> {
  const jwtAccessSecret = requiredSecret(value.jwtAccessSecret);
  const jwtRefreshSecret = requiredSecret(value.jwtRefreshSecret);
  const mcpSecretEncryptionKey = requiredSecret(value.mcpSecretEncryptionKey);

  let encryptionKey: Buffer;
  try {
    encryptionKey = /^[0-9a-f]{64}$/i.test(mcpSecretEncryptionKey)
      ? Buffer.from(mcpSecretEncryptionKey, 'hex')
      : Buffer.from(mcpSecretEncryptionKey, 'base64');
  } catch {
    throw invalidPayloadError();
  }

  if (encryptionKey.length !== 32) {
    throw invalidPayloadError();
  }

  return {
    jwtAccessSecret,
    jwtRefreshSecret,
    mcpSecretEncryptionKey,
  };
}

function createPassword(): string {
  return randomBytes(36).toString('base64url');
}

function requiredSecret(value: unknown): string {
  const secret = String(value ?? '').trim();
  if (!secret) throw invalidPayloadError();
  return secret;
}

function invalidPayloadError(): Error & { code: string } {
  return Object.assign(
    new Error('SEEKMORE runtime secret payload is invalid.'),
    { code: 'RUNTIME_SECRET_PAYLOAD_INVALID' },
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
