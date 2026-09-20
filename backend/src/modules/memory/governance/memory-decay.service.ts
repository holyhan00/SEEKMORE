                                                                
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MemoryRepository } from '../storage/prisma/memory.repository';

@Injectable()
export class MemoryDecayService {
  private readonly logger = new Logger(MemoryDecayService.name);

  constructor(private readonly repo: MemoryRepository) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async softDeleteExpiredMemories(): Promise<void> {
    const result = await this.repo.softDeleteExpiredByDecay({
      now: new Date(),
      limit: 500,
    });

    if (result.deleted > 0) {
      this.logger.log(`Auto decay deleted ${result.deleted} expired memory facts`);
    }
  }
}