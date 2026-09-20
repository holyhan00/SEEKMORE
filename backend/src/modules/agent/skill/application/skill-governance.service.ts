import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import {
  SkillPermissionAction,
  SkillPrincipalType,
  SkillSecurityState,
  SkillStatus,
  SkillValidationStatus,
} from "@prisma/client";
import type { ReplaceSkillAclDto } from "../api/dto/skill.dto";
import { SkillAccessService } from "./skill-access.service";
import { SkillRepository } from "../persistence/skill.repository";
import { SkillAuditService } from "../usage/skill-audit.service";
import { toSkillApiJson } from "../domain/skill-json.util";

@Injectable()
export class SkillGovernanceService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly audit: SkillAuditService,
  ) {}

  async permissions(userId: string, skillId: string) {
    await this.access.manageable(userId, skillId);
    return this.repository.client().skillAclEntry.findMany({
      where: { skillId },
      orderBy: [{ principalType: "asc" }, { principalId: "asc" }],
    });
  }

  async replacePermissions(
    userId: string,
    skillId: string,
    dto: ReplaceSkillAclDto,
  ) {
    await this.access.manageable(userId, skillId);
    const keys = dto.entries.map(
      (entry) => `${entry.principalType}:${entry.principalId.trim()}`,
    );
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException("DUPLICATE_SKILL_ACL_PRINCIPAL");
    for (const entry of dto.entries) {
      if (!entry.permissions.length)
        throw new BadRequestException("SKILL_ACL_PERMISSION_REQUIRED");
      if (
        entry.principalType === SkillPrincipalType.PUBLIC &&
        entry.principalId !== "public"
      ) {
        throw new BadRequestException(
          "PUBLIC_SKILL_ACL_PRINCIPAL_ID_MUST_BE_PUBLIC",
        );
      }
      if (
        entry.permissions.includes(SkillPermissionAction.MANAGE) &&
        entry.principalType === SkillPrincipalType.PUBLIC
      ) {
        throw new BadRequestException("PUBLIC_MANAGE_PERMISSION_NOT_ALLOWED");
      }
    }
    await this.repository.transaction(async (tx) => {
      await tx.skillAclEntry.deleteMany({ where: { skillId } });
      if (dto.entries.length) {
        await tx.skillAclEntry.createMany({
          data: dto.entries.map((entry) => ({
            skillId,
            principalType: entry.principalType,
            principalId: entry.principalId.trim(),
            permissions: [...new Set(entry.permissions)],
          })),
        });
      }
      await tx.skill.update({
        where: { id: skillId },
        data: { revision: { increment: 1 } },
      });
      await this.audit.write(
        {
          skillId,
          actorUserId: userId,
          eventType: "skill.permissions.replaced",
          afterData: dto.entries,
        },
        tx,
      );
    });
    return this.permissions(userId, skillId);
  }

  async quarantine(userId: string, skillId: string, reason: string) {
    const before = await this.access.manageable(userId, skillId);
    const updated = await this.repository.client().skill.update({
      where: { id: skillId },
      data: {
        securityState: SkillSecurityState.QUARANTINED,
        quarantinedAt: new Date(),
        quarantineReason: reason.trim(),
        revision: { increment: 1 },
      },
    });
    await this.audit.write({
      skillId,
      actorUserId: userId,
      eventType: "skill.quarantined",
      severity: "warning",
      beforeData: before,
      afterData: updated,
    });
    return toSkillApiJson(updated);
  }

  async restoreSecurity(userId: string, skillId: string) {
    const skill = await this.access.manageable(userId, skillId);
    if (!skill.currentVersionId)
      throw new ConflictException("SKILL_CURRENT_VERSION_REQUIRED");
    const passed = await this.repository.client().skillValidationRun.findFirst({
      where: {
        skillVersionId: skill.currentVersionId,
        status: SkillValidationStatus.PASSED,
        packageChecksum: skill.currentVersion?.packageChecksum,
      },
      orderBy: { finishedAt: "desc" },
    });
    if (!passed) throw new ConflictException("SKILL_REVALIDATION_REQUIRED");
    const updated = await this.repository.client().skill.update({
      where: { id: skillId },
      data: {
        securityState: SkillSecurityState.CLEAR,
        quarantinedAt: null,
        quarantineReason: null,
        revision: { increment: 1 },
      },
    });
    await this.audit.write({
      skillId,
      actorUserId: userId,
      eventType: "skill.quarantine.cleared",
      beforeData: skill,
      afterData: updated,
    });
    return toSkillApiJson(updated);
  }

  async pin(userId: string, skillId: string, pinned: boolean) {
    const before = await this.access.manageable(userId, skillId);
    const updated = await this.repository
      .client()
      .skill.update({
        where: { id: skillId },
        data: { pinned, revision: { increment: 1 } },
      });
    await this.audit.write({
      skillId,
      actorUserId: userId,
      eventType: pinned ? "skill.pinned" : "skill.unpinned",
      beforeData: before,
      afterData: updated,
    });
    return toSkillApiJson(updated);
  }

  async markStale(userId: string, skillId: string) {
    const before = await this.access.manageable(userId, skillId);
    if (before.status === SkillStatus.ARCHIVED)
      throw new BadRequestException("ARCHIVED_SKILL_CANNOT_BE_MARKED_STALE");
    const updated = await this.repository.client().skill.update({
      where: { id: skillId },
      data: {
        status: SkillStatus.STALE,
        staleAt: new Date(),
        revision: { increment: 1 },
      },
    });
    await this.audit.write({
      skillId,
      actorUserId: userId,
      eventType: "skill.marked_stale",
      beforeData: before,
      afterData: updated,
    });
    return toSkillApiJson(updated);
  }
}
