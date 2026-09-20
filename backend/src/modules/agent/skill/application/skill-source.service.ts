import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { UpdateSkillSourceDto } from '../api/dto/skill.dto';
import type { JsonObject } from '../domain/skill.types';
import { SkillAccessService } from './skill-access.service';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillAuditService } from '../usage/skill-audit.service';
import { SkillSourceAdapterRegistry } from '../source/skill-source-adapter.registry';

@Injectable()
export class SkillSourceService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly audit: SkillAuditService,
    private readonly adapters: SkillSourceAdapterRegistry,
  ) {}

  async get(userId: string, skillId: string) {
    await this.access.readable(userId, skillId);
    return this.repository.client().skillSource.findUnique({ where: { skillId } });
  }

  async update(userId: string, skillId: string, dto: UpdateSkillSourceDto) {
    await this.access.manageable(userId, skillId);
    const normalized = this.adapters.normalize({
      kind: dto.kind,
      sourceRef: dto.sourceRef?.trim() || null,
      sourceRevision: dto.sourceRevision?.trim() || null,
      provenance: (dto.provenance ?? {}) as JsonObject,
      lockData: (dto.lockData ?? {}) as JsonObject,
      checksum: dto.checksum?.trim() || null,
    });
    return this.repository.transaction(async (tx) => {
      const before = await tx.skillSource.findUnique({ where: { skillId } });
      const data = {
        kind: normalized.kind,
        sourceRef: normalized.sourceRef,
        sourceRevision: normalized.sourceRevision,
        provenance: normalized.provenance as Prisma.InputJsonValue,
        lockData: normalized.lockData as Prisma.InputJsonValue,
        checksum: normalized.checksum,
      };
      const updated = await tx.skillSource.upsert({
        where: { skillId },
        create: { skillId, ...data },
        update: data,
      });
      await tx.skill.update({ where: { id: skillId }, data: { revision: { increment: 1 } } });
      await this.audit.write({ skillId, actorUserId: userId, eventType: 'skill.source.updated', beforeData: before, afterData: updated }, tx);
      return updated;
    });
  }
}
