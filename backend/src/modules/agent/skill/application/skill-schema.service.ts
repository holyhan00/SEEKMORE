import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SkillVersionStatus } from '@prisma/client';
import type { ReplaceSkillSchemasDto } from '../api/dto/skill.dto';
import { SkillAccessService } from './skill-access.service';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillAuditService } from '../usage/skill-audit.service';

@Injectable()
export class SkillSchemaService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly audit: SkillAuditService,
  ) {}

  async get(userId: string, skillId: string, versionId: string) {
    await this.access.readable(userId, skillId);
    const version = await this.repository.client().skillVersion.findFirst({
      where: { id: versionId, skillId },
      select: { id: true },
    });
    if (!version) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');
    return this.repository.client().skillConfigSchema.findMany({
      where: { skillVersionId: versionId },
      orderBy: { kind: 'asc' },
    });
  }

  async replace(userId: string, skillId: string, versionId: string, dto: ReplaceSkillSchemasDto) {
    await this.access.manageable(userId, skillId);
    const kinds = dto.schemas.map((item) => item.kind);
    if (new Set(kinds).size !== kinds.length) throw new BadRequestException('DUPLICATE_SKILL_SCHEMA_KIND');
    await this.repository.transaction(async (tx) => {
      const version = await tx.skillVersion.findFirst({ where: { id: versionId, skillId } });
      if (!version) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');
      if (version.status !== SkillVersionStatus.DRAFT) throw new BadRequestException('PUBLISHED_SKILL_VERSION_IMMUTABLE');
      await tx.skillConfigSchema.deleteMany({ where: { skillVersionId: versionId } });
      if (dto.schemas.length) {
        await tx.skillConfigSchema.createMany({
          data: dto.schemas.map((item) => ({
            skillVersionId: versionId,
            kind: item.kind,
            schema: item.schema as Prisma.InputJsonValue,
          })),
        });
      }
      await tx.skillVersion.update({ where: { id: versionId }, data: { revision: { increment: 1 } } });
      await this.audit.write({
        skillId,
        skillVersionId: versionId,
        actorUserId: userId,
        eventType: 'skill.schemas.replaced',
        afterData: { kinds },
      }, tx);
    });
    return this.get(userId, skillId, versionId);
  }
}
