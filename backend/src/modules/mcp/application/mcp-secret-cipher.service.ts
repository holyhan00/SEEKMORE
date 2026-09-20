import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  encryptedPayload: Buffer;
  encryptionIv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

@Injectable()
export class McpSecretCipherService {
  encrypt(value: Record<string, string>): EncryptedSecret {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encryptedPayload = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return { encryptedPayload, encryptionIv: iv, authTag: cipher.getAuthTag(), keyVersion: 1 };
  }

  decrypt(row: { encryptedPayload?: Buffer | null; encryptionIv?: Buffer | null; authTag?: Buffer | null }): Record<string, string> {
    if (!row.encryptedPayload || !row.encryptionIv || !row.authTag) return {};
    const decipher = createDecipheriv('aes-256-gcm', this.key(), row.encryptionIv);
    decipher.setAuthTag(row.authTag);
    const raw = Buffer.concat([decipher.update(row.encryptedPayload), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('MCP_CREDENTIAL_PAYLOAD_INVALID');
    }
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]));
  }

  private key(): Buffer {
    const raw = String(process.env.MCP_SECRET_ENCRYPTION_KEY ?? '').trim();
    if (!raw) {
      throw new ServiceUnavailableException('MCP_SECRET_ENCRYPTION_KEY_REQUIRED');
    }
    const candidate = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (candidate.length !== 32) {
      throw new ServiceUnavailableException('MCP_SECRET_ENCRYPTION_KEY_INVALID');
    }
    return candidate;
  }
}
