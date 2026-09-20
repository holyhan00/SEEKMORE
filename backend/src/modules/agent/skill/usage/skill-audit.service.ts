import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SkillRepository, type SkillDbClient } from '../persistence/skill.repository';
import { toSkillPrismaJson } from '../domain/skill-json.util';

@Injectable()
export class SkillAuditService {
  constructor(private readonly repository: SkillRepository) {}

  write(input: {
    skillId: string;
    skillVersionId?: string | null;
    actorUserId?: string | null;
    eventType: string;
    severity?: string;
    traceId?: string | null;
    beforeData?: unknown;
    afterData?: unknown;
    metadata?: unknown;
  }, client: SkillDbClient = this.repository.client()) {
    return client.skillAuditLog.create({
      data: {
        skillId: input.skillId,
        skillVersionId: input.skillVersionId ?? null,
        actorUserId: input.actorUserId ?? null,
        eventType: input.eventType,
        severity: input.severity ?? 'info',
        traceId: input.traceId ?? null,
        beforeData: input.beforeData === undefined
          ? Prisma.JsonNull
          : toSkillPrismaJson(input.beforeData),
        afterData: input.afterData === undefined
          ? Prisma.JsonNull
          : toSkillPrismaJson(input.afterData),
        metadata: toSkillPrismaJson(input.metadata ?? {}),
      },
    });
  }
}
