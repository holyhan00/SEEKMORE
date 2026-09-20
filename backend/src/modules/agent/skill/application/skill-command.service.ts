import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  SkillActivationMode,
  SkillSourceKind,
  SkillStatus,
  SkillVisibility,
} from '@prisma/client';
import type { CreateSkillDto, UpdateSkillDto } from '../api/dto/skill.dto';
import { normalizeSkillDisplayName } from '../domain/skill-identity.util';
import { toSkillApiJson } from '../domain/skill-json.util';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillAuditService } from '../usage/skill-audit.service';
import { SkillAccessService } from './skill-access.service';
import { SkillCreationService } from './skill-creation.service';

const RETENTION_DAYS = 30;

@Injectable()
export class SkillCommandService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly audit: SkillAuditService,
    private readonly creation: SkillCreationService,
  ) {}

  create(userId: string, dto: CreateSkillDto) {
    return this.creation.create(userId, {
      source: 'USER_AUTHORED',
      displayName: dto.displayName?.trim() || null,
      sourceKind: SkillSourceKind.INLINE,
      sourceRef: null,
      rootName: null,
      skillMarkdown: dto.skillMarkdown,
      resources: [],
      provenance: { creationMethod: 'USER_AUTHORED' },
    });
  }

  async update(userId: string, skillId: string, dto: UpdateSkillDto) {
    let displayName: string | undefined;

    try {
      displayName =
        dto.displayName !== undefined
          ? normalizeSkillDisplayName(dto.displayName, '')
          : undefined;
    } catch {
      throw new BadRequestException({
        code: 'SKILL_DISPLAY_NAME_INVALID',
        message: 'SKILL_DISPLAY_NAME_INVALID',
      });
    }

    const before = await this.access.manageable(userId, skillId);
    if (
      dto.expectedRevision !== undefined &&
      before.revision !== dto.expectedRevision
    ) {
      throw new ConflictException('SKILL_REVISION_CONFLICT');
    }
    const updated = await this.repository.client().skill.update({
      where: { id: skillId },
      data: {
        ...(displayName !== undefined
          ? { displayName }
          : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.defaultActivationMode !== undefined
          ? { defaultActivationMode: dto.defaultActivationMode }
          : {}),
        revision: { increment: 1 },
      },
    });
    await this.audit.write({
      skillId,
      actorUserId: userId,
      eventType: 'skill.settings.updated',
      beforeData: before,
      afterData: updated,
    });
    return toSkillApiJson(updated);
  }

  async softDelete(userId: string, skillId: string) {
    return this.repository.transaction(async (tx) => {
      const skill = await tx.skill.findUnique({ where: { id: skillId } });
      if (!skill) throw new NotFoundException('SKILL_NOT_FOUND');
      if (skill.ownerUserId !== userId) {
        throw new ForbiddenException('SKILL_DELETE_OWNER_REQUIRED');
      }
      if (skill.deletedAt) {
        return toSkillApiJson({
          id: skill.id,
          deletedAt: skill.deletedAt,
          purgeAfter: skill.purgeAfter,
        });
      }

      const deletedAt = new Date();
      const purgeAfter = new Date(
        deletedAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );

      const updated = await tx.skill.update({
        where: { id: skillId },
        data: {
          deletedAt,
          purgeAfter,
          status: SkillStatus.ARCHIVED,
          archivedAt: deletedAt,
          defaultActivationMode: SkillActivationMode.DISABLED,
          visibility: SkillVisibility.PRIVATE,
          revision: { increment: 1 },
        },
      });

      await this.audit.write(
        {
          skillId,
          actorUserId: userId,
          eventType: 'skill.deleted',
          severity: 'warning',
          beforeData: skill,
          afterData: updated,
          metadata: { retentionDays: RETENTION_DAYS },
        },
        tx,
      );

      return toSkillApiJson({ id: skillId, deletedAt, purgeAfter });
    });
  }
}
