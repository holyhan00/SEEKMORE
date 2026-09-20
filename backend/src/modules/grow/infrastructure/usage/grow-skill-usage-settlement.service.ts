import { Injectable } from '@nestjs/common';
import {
  SkillUsageOutcome,
} from '@prisma/client';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../../../../prisma/prisma.service';
import { SkillUsageRecorderService } from '../../../agent/skill/usage/skill-usage-recorder.service';
import { GrowEffectTrackerService } from '../../core/grow-effect-tracker.service';
import type {
  GrowSkillUseOutcome,
  GrowTerminalEvent,
} from '../../domain/grow.types';

@Injectable()
export class GrowSkillUsageSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: SkillUsageRecorderService,
    private readonly effects: GrowEffectTrackerService,
  ) {}

  async settle(
    event: GrowTerminalEvent,
  ): Promise<void> {
    const rows =
      await this.prisma.skillUsageEvent.findMany({
        where: {
          traceId: event.traceId,
          outcome: {
            in: [
              SkillUsageOutcome.LOADED,
              SkillUsageOutcome.DEPENDENCY_MISSING,
            ],
          },
        },
        orderBy: {
          occurredAt: 'asc',
        },
      });

    const unique = new Map(
      rows.map((row) => [
        `${row.skillId}:${row.skillVersionId}`,
        row,
      ]),
    );

    for (const row of unique.values()) {
      if (
        row.outcome
        === SkillUsageOutcome.DEPENDENCY_MISSING
      ) {
        await this.effects.recordUsage(
          this.effectEvent(
            event,
            row,
            'load_failed',
          ),
        );

        continue;
      }

      const outcome =
        this.terminalOutcome(event.status);

      if (!outcome) {
        continue;
      }

      const prismaOutcome =
        outcome === 'completed'
          ? SkillUsageOutcome.COMPLETED
          : SkillUsageOutcome.FAILED;

      const exists =
        await this.prisma.skillUsageEvent.findFirst({
          where: {
            traceId: event.traceId,
            skillVersionId: row.skillVersionId,
            outcome: prismaOutcome,
          },
          select: {
            id: true,
          },
        });

      if (!exists) {
        await this.usage.record({
          skillId: row.skillId,
          skillVersionId: row.skillVersionId,
          userId: row.userId,
          agentId: row.agentId,
          conversationId: row.conversationId,
          traceId: event.traceId,
          turnId: event.turnId,
          activationMode: row.activationMode,
          activationSource: row.activationSource,
          outcome: prismaOutcome,
          reason: event.status,
          confidence: row.confidence,
          metadata: {
            source: 'grow_terminal_settlement',
          },
        });
      }

      await this.effects.recordUsage(
        this.effectEvent(
          event,
          row,
          outcome,
        ),
      );
    }
  }

  private terminalOutcome(
    status: GrowTerminalEvent['status'],
  ): GrowSkillUseOutcome | null {
    if (
      status === 'succeeded'
      || status === 'partial'
    ) {
      return 'completed';
    }

    if (status === 'failed') {
      return 'failed';
    }

    return null;
  }

  private effectEvent(
    event: GrowTerminalEvent,
    row: {
      skillId: string;
      skillVersionId: string;
      userId: string | null;
    },
    outcome: GrowSkillUseOutcome,
  ) {
    return {
      eventId: createHash('sha256')
        .update(
          `${event.eventId}:${row.skillVersionId}:${outcome}`,
        )
        .digest('hex'),
      userId: row.userId ?? event.userId,
      skillId: row.skillId,
      versionId: row.skillVersionId,
      traceId: event.traceId,
      outcome,
      occurredAt: event.occurredAt,
      reason: event.status,
    };
  }
}