import { Injectable } from '@nestjs/common';
import type { JsonObject, JsonValue } from '../domain/json.types';

const SENSITIVE_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'apikey',
  'api_key',
  'secret',
  'password',
  'clientsecret',
  'cookie',
  'privatekey',
  'private_key',
]);

function sensitive(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('password')
  );
}

@Injectable()
export class McpSecretRedactorService {
  redactJson(value: JsonValue): JsonValue {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactJson(item));
    }
    if (!value || typeof value !== 'object') return value;

    const output: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = sensitive(key)
        ? '[REDACTED]'
        : this.redactJson(child as JsonValue);
    }
    return output;
  }
}
