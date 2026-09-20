import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../modules/redis/redis.service';
import type { TimeUserState } from './time.types';

const USER_INDEX_KEY = 'seekmore:time:users';
const LOCK_TTL_MS = 30_000;
const INDEX_LOCK_KEY = 'seekmore:time:users:lock';

function emptyState(): TimeUserState {
  return {
    entries: [],
    notifications: [],
  };
}

@Injectable()
export class TimeStoreService {
  private readonly logger = new Logger(TimeStoreService.name);
  private readonly memory = new Map<string, TimeUserState>();
  private readonly memoryUsers = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private redisWarningLogged = false;

  constructor(private readonly redis: RedisService) {}

  async read(userId: string): Promise<TimeUserState> {
    return this.serial(async () => this.readUnlocked(userId));
  }

  async mutate<T>(
    userId: string,
    mutator: (state: TimeUserState) => T | Promise<T>,
  ): Promise<T> {
    return this.serial(async () => {
      let locked = false;
      try {
        locked = await this.acquireUserLock(userId);
        const state = await this.readUnlocked(userId);
        const result = await mutator(state);
        this.trim(state);
        await this.writeUnlocked(userId, state);
        await this.ensureUserIndexed(userId);
        return result;
      } finally {
        if (locked) {
          try {
            await this.redis.del(this.lockKey(userId));
          } catch {
                                                                  
          }
        }
      }
    });
  }

  async listUsers(): Promise<string[]> {
    return this.serial(async () => {
      try {
        const raw = await this.redis.get(USER_INDEX_KEY);
        const users = this.stringArray(raw);
        for (const userId of this.memoryUsers) users.push(userId);
        return [...new Set(users)].sort();
      } catch (error) {
        this.warnRedisFallback(error);
        return [...this.memoryUsers].sort();
      }
    });
  }

  private async readUnlocked(userId: string): Promise<TimeUserState> {
    try {
      const raw = await this.redis.get(this.userKey(userId));
      if (!raw) return this.clone(this.memory.get(userId) ?? emptyState());
      const parsed = JSON.parse(raw) as Partial<TimeUserState>;
      return {
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      };
    } catch (error) {
      this.warnRedisFallback(error);
      return this.clone(this.memory.get(userId) ?? emptyState());
    }
  }

  private async writeUnlocked(userId: string, state: TimeUserState): Promise<void> {
    this.memory.set(userId, this.clone(state));
    this.memoryUsers.add(userId);
    try {
      await this.redis.set(this.userKey(userId), JSON.stringify(state));
    } catch (error) {
      this.warnRedisFallback(error);
    }
  }

  private async ensureUserIndexed(userId: string): Promise<void> {
    this.memoryUsers.add(userId);
    let locked = false;
    try {
      locked = await this.acquireLock(INDEX_LOCK_KEY);
      const raw = await this.redis.get(USER_INDEX_KEY);
      const users = this.stringArray(raw);
      if (!users.includes(userId)) {
        users.push(userId);
        await this.redis.set(USER_INDEX_KEY, JSON.stringify(users));
      }
    } catch (error) {
      this.warnRedisFallback(error);
    } finally {
      if (locked) {
        try { await this.redis.del(INDEX_LOCK_KEY); } catch {}
      }
    }
  }

  private async acquireUserLock(userId: string): Promise<boolean> {
    return this.acquireLock(this.lockKey(userId));
  }

  private async acquireLock(key: string): Promise<boolean> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if (await this.redis.setNx(key, randomUUID(), LOCK_TTL_MS)) return true;
      } catch (error) {
        this.warnRedisFallback(error);
        return false;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Time state lock timeout: ${key}`);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private trim(state: TimeUserState): void {
    if (state.notifications.length > 300) {
      state.notifications.splice(0, state.notifications.length - 300);
    }
    if (state.entries.length > 500) {
      const active = state.entries.filter((entry) => !['completed', 'cancelled'].includes(entry.status));
      const historical = state.entries
        .filter((entry) => ['completed', 'cancelled'].includes(entry.status))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(0, 500 - active.length));
      state.entries = [...active, ...historical];
    }
  }

  private stringArray(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((value) => String(value).trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private userKey(userId: string): string {
    return `seekmore:time:user:${encodeURIComponent(userId)}`;
  }

  private lockKey(userId: string): string {
    return `seekmore:time:lock:${encodeURIComponent(userId)}`;
  }

  private warnRedisFallback(error: unknown): void {
    if (this.redisWarningLogged) return;
    this.redisWarningLogged = true;
    this.logger.warn(`Redis unavailable for Time Tool; using process-local fallback: ${error instanceof Error ? error.message : String(error)}`);
  }
}
