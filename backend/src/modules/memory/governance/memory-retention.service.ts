                                                                    

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MemoryRepository } from '../storage/prisma/memory.repository';

@Injectable()
export class MemoryRetentionService {
  private readonly logger = new Logger(MemoryRetentionService.name);

  constructor(private readonly repo: MemoryRepository) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredDeletedFacts(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await this.repo.purgeExpiredDeletedFacts({
      cutoff,
      limit: 500,
    });

    if (result.purged > 0) {
      this.logger.log(`Auto purged ${result.purged} deleted memory facts`);
    }
  }
}