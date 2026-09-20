import { Injectable } from '@nestjs/common';
import { Prisma, SkillActivationMode, SkillActivationSource, SkillUsageOutcome } from '@prisma/client';
import { SkillRepository } from '../persistence/skill.repository';

@Injectable()
export class SkillUsageRecorderService {
  constructor(private readonly repository: SkillRepository) {}

  async record(input: {
    skillId: string;
    skillVersionId: string;
    userId?: string | null;
    agentId?: string | null;
    conversationId?: string | null;
    traceId?: string | null;
    turnId?: string | null;
    activationMode: SkillActivationMode;
    activationSource: SkillActivationSource;
    outcome: SkillUsageOutcome;
    reason?: string | null;
    confidence?: number | null;
    tokenEstimate?: number | null;
    durationMs?: number | null;
    dependencyStatus?: unknown;
    metadata?: unknown;
  }): Promise<void> {
    const prisma = this.repository.client();
    const writes: Prisma.PrismaPromise<unknown>[] = [
      prisma.skillUsageEvent.create({ data: {
        skillId: input.skillId,
        skillVersionId: input.skillVersionId,
        userId: input.userId ?? null,
        agentId: input.agentId ?? null,
        conversationId: input.conversationId ?? null,
        traceId: input.traceId ?? null,
        turnId: input.turnId ?? null,
        activationMode: input.activationMode,
        activationSource: input.activationSource,
        outcome: input.outcome,
        reason: input.reason ?? null,
        confidence: input.confidence ?? null,
        tokenEstimate: input.tokenEstimate ?? null,
        durationMs: input.durationMs ?? null,
        dependencyStatus: (input.dependencyStatus ?? {}) as Prisma.InputJsonValue,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      } }),
    ];
    if (input.outcome === SkillUsageOutcome.COMPLETED) {
      writes.push(prisma.skill.update({
        where: { id: input.skillId },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      }));
    }
    await prisma.$transaction(writes).catch(() => undefined);
  }
}
