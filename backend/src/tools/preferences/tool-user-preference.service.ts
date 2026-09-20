import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../modules/redis/redis.service';

const USER_DISABLED_TOOLS_KEY_PREFIX = 'seekmore:tools:disabled';

@Injectable()
export class ToolUserPreferenceService {
  private readonly logger = new Logger(ToolUserPreferenceService.name);

  constructor(
    private readonly redis: RedisService,
  ) {}

  async disabledToolNames(userId: string): Promise<Set<string>> {
    const normalizedUserId = String(userId ?? '').trim();

    if (!normalizedUserId) {
      return new Set<string>();
    }

    try {
      const names = await this.redis.sMembers(
        this.key(normalizedUserId),
      );

      return new Set(
        names
          .map((name) => String(name).trim())
          .filter(Boolean),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to read tool preferences for user ${normalizedUserId}; defaulting tools to enabled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return new Set<string>();
    }
  }

  async isEnabled(
    userId: string,
    toolName: string,
  ): Promise<boolean> {
    const normalizedUserId = String(userId ?? '').trim();
    const normalizedToolName = String(toolName ?? '').trim();

    if (!normalizedUserId || !normalizedToolName) {
      return true;
    }

    try {
      const disabled = await this.redis.sIsMember(
        this.key(normalizedUserId),
        normalizedToolName,
      );

      return !disabled;
    } catch (error) {
      this.logger.warn(
        `Failed to read tool preference for ${normalizedToolName}; defaulting to enabled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return true;
    }
  }

  async setEnabled(
    userId: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void> {
    const normalizedUserId = String(userId ?? '').trim();
    const normalizedToolName = String(toolName ?? '').trim();

    if (!normalizedUserId) {
      throw new Error('userId is required to update a tool preference');
    }

    if (!normalizedToolName) {
      throw new Error('toolName is required to update a tool preference');
    }

    const key = this.key(normalizedUserId);

    if (enabled) {
      await this.redis.sRemove(key, normalizedToolName);
      return;
    }

    await this.redis.sAdd(key, normalizedToolName);
  }

  private key(userId: string): string {
    return `${USER_DISABLED_TOOLS_KEY_PREFIX}:${userId}`;
  }
}
