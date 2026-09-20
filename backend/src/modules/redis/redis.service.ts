                                     
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  onModuleInit() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connected');
    });
    this.client.on('error', (error) => {
      this.logger.error(
        'Redis connection error',
        error instanceof Error
          ? error.stack
          : String(error),
      );
    });
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }

           
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(
    key: string,
    value: string,
    mode?: 'EX' | 'PX',
    duration?: number
  ): Promise<'OK'> {
    if (mode && duration !== undefined) {
      return this.client.set(
        key,
        value,
        mode as 'EX',              
        duration
      );
    }
    return this.client.set(key, value);
  }


  async setNx(key: string, value: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    return (await this.client.expire(key, seconds)) === 1;
  }

  async sMembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sIsMember(
    key: string,
    member: string,
  ): Promise<boolean> {
    return (await this.client.sismember(key, member)) === 1;
  }

  async sAdd(
    key: string,
    member: string,
  ): Promise<number> {
    return this.client.sadd(key, member);
  }

  async sRemove(
    key: string,
    member: string,
  ): Promise<number> {
    return this.client.srem(key, member);
  }
}