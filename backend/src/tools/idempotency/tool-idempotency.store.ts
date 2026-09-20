import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RedisService } from '../../modules/redis/redis.service';
import type { Dict, Tool, ToolContext, ToolResult } from '../toolstypes';

export type IdempotencyAcquireResult =
  | { status: 'acquired'; storageKey: string; owner: string }
  | { status: 'cached'; result: ToolResult }
  | { status: 'in_progress' };

@Injectable()
export class ToolIdempotencyStore {
  constructor(private readonly redis: RedisService) {}

  async acquire(tool: Tool, args: Dict, context: ToolContext, ttlMs: number): Promise<IdempotencyAcquireResult> {
    const storageKey = this.key(tool, args, context);
    const owner = randomUUID();
    const acquired = await this.redis.setNx(storageKey, `processing:${owner}`, ttlMs);
    if (acquired) return { status: 'acquired', storageKey, owner };
    const existing = await this.redis.get(storageKey);
    if (existing?.startsWith('result:')) {
      try {
        return { status: 'cached', result: JSON.parse(existing.slice(7)) as ToolResult };
      } catch {
        await this.redis.del(storageKey);
      }
    }
    return { status: 'in_progress' };
  }

  async complete(storageKey: string, result: ToolResult, ttlMs: number): Promise<void> {
    await this.redis.set(storageKey, `result:${JSON.stringify(result)}`, 'PX', ttlMs);
  }

  async release(storageKey: string): Promise<void> {
    await this.redis.del(storageKey);
  }

  private key(tool: Tool, args: Dict, context: ToolContext): string {
    const canonical = stableStringify({
      suppliedKey: context.idempotencyKey,
      userId: context.userId,
      tenantId: context.tenantId ?? null,
      tool: tool.name,
      version: tool.version ?? '1.0.0',
      args,
    });
    return `seekmore:tool-idempotency:${createHash('sha256').update(canonical).digest('hex')}`;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
