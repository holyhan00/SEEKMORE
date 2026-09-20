import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  SkillActivationMode,
  SkillInstallationStatus,
  SkillSecurityState,
  SkillStatus,
  SkillValidationStatus,
  SkillVersionStatus,
} from "@prisma/client";
import { SkillAccessService } from "./skill-access.service";
import { SkillRepository } from "../persistence/skill.repository";
import { SkillAuditService } from "../usage/skill-audit.service";
import { SkillVersionService } from "./skill-version.service";
import { toSkillApiJson } from "../domain/skill-json.util";
import { SkillFrontmatterParser } from "../validation/skill-frontmatter.parser";
import { SkillDocumentValidator } from "../validation/skill-document.validator";

@Injectable()
export class SkillLifecycleService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly versions: SkillVersionService,
    private readonly audit: SkillAuditService,
    private readonly parser: SkillFrontmatterParser,
    private readonly documentValidator: SkillDocumentValidator,
  ) {}

  async publish(userId: string, skillId: string, versionId?: string) {
    const skill = await this.access.manageable(userId, skillId);
    if (skill.deletedAt) throw new ConflictException("SKILL_DELETED");
    const version = versionId
      ? await this.repository
          .client()
          .skillVersion.findFirst({ where: { id: versionId, skillId } })
      : await this.repository
          .client()
          .skillVersion.findFirst({
            where: { skillId, status: SkillVersionStatus.DRAFT },
            orderBy: { versionNumber: "desc" },
          });
    if (!version || version.status !== SkillVersionStatus.DRAFT)
      throw new NotFoundException("SKILL_DRAFT_VERSION_NOT_FOUND");
    if (skill.securityState !== SkillSecurityState.CLEAR)
      throw new ConflictException("SKILL_SECURITY_REVIEW_REQUIRED");
    const validation = await this.repository
      .client()
      .skillValidationRun.findFirst({
        where: {
          skillVersionId: version.id,
          packageChecksum: version.packageChecksum,
          status: SkillValidationStatus.PASSED,
        },
        orderBy: { finishedAt: "desc" },
      });
    if (!validation) throw new ConflictException("SKILL_VALIDATION_REQUIRED");
    const parsed = this.parser.parse(version.skillMarkdown);
    const files = await this.repository.client().skillFile.findMany({
      where: { skillVersionId: version.id },
      select: { path: true, fileType: true, mimeType: true, textContent: true },
    });
    this.documentValidator.assertValid(parsed, {
      rootName: skill.name,
      resources: files.map((file) => ({
        path: file.path,
        fileType: file.fileType,
        mimeType: file.mimeType,
        buffer: file.textContent ? Buffer.from(file.textContent, 'utf8') : Buffer.alloc(0),
      })),
    });
    if (parsed.manifest.name !== skill.name) {
      throw new ConflictException("SKILL_NAME_IMMUTABLE");
    }
    return this.repository.transaction(async (tx) => {
      if (skill.currentVersionId && skill.currentVersionId !== version.id) {
        await tx.skillVersion.updateMany({
          where: {
            id: skill.currentVersionId,
            status: SkillVersionStatus.PUBLISHED,
          },
          data: { status: SkillVersionStatus.SUPERSEDED },
        });
      }
      const published = await tx.skillVersion.update({
        where: { id: version.id },
        data: { status: SkillVersionStatus.PUBLISHED, publishedAt: new Date() },
      });
      const updatedSkill = await tx.skill.update({
        where: { id: skillId },
        data: {
          name: parsed.manifest.name,
          slug: parsed.manifest.name,
          description: parsed.manifest.description,
          activationDescription: parsed.manifest.description,
          currentVersionId: version.id,
          status: SkillStatus.ACTIVE,
          archivedAt: null,
          staleAt: null,
          revision: { increment: 1 },
        },
      });
      await this.audit.write(
        {
          skillId,
          skillVersionId: version.id,
          actorUserId: userId,
          eventType: "skill.published",
          afterData: { version: published.versionLabel },
        },
        tx,
      );
      return toSkillApiJson({ skill: updatedSkill, version: published });
    });
  }

  setStatus(
    userId: string,
    skillId: string,
    action: "disable" | "archive" | "restore",
  ) {
    return this.repository.transaction(async (tx) => {
      const skill = await this.access.manageable(userId, skillId, tx);
      if (skill.deletedAt) throw new ConflictException("SKILL_DELETED");
      const data =
        action === "disable"
          ? { status: SkillStatus.DISABLED, revision: { increment: 1 } }
          : action === "archive"
            ? {
                status: SkillStatus.ARCHIVED,
                archivedAt: new Date(),
                revision: { increment: 1 },
              }
            : {
                status:
                  skill.currentVersionId &&
                  skill.securityState === SkillSecurityState.CLEAR
                    ? SkillStatus.ACTIVE
                    : SkillStatus.DRAFT,
                archivedAt: null,
                revision: { increment: 1 },
              };
      const updated = await tx.skill.update({ where: { id: skillId }, data });
      await this.audit.write(
        {
          skillId,
          actorUserId: userId,
          eventType: `skill.${action}d`,
          beforeData: skill,
          afterData: updated,
        },
        tx,
      );
      return toSkillApiJson(updated);
    });
  }

  restoreDeleted(
    userId: string,
    skillId: string,
  ) {
    return this.repository.transaction(async (tx) => {
      const skill = await this.access.deletedOwner(
        userId,
        skillId,
        tx,
      );

      if (
        skill.purgeAfter &&
        skill.purgeAfter.getTime() <= Date.now()
      ) {
        throw new NotFoundException(
          'SKILL_DELETION_RETENTION_EXPIRED',
        );
      }

      const restoredStatus =
        skill.currentVersionId &&
        skill.securityState === SkillSecurityState.CLEAR
          ? SkillStatus.ACTIVE
          : SkillStatus.DRAFT;

      const updated = await tx.skill.update({
        where: {
          id: skillId,
        },
        data: {
          deletedAt: null,
          purgeAfter: null,
          archivedAt: null,
          status: restoredStatus,
          defaultActivationMode:
            restoredStatus === SkillStatus.ACTIVE
              ? SkillActivationMode.AUTOMATIC
              : SkillActivationMode.DISABLED,
          revision: {
            increment: 1,
          },
        },
      });

      await this.audit.write(
        {
          skillId,
          actorUserId: userId,
          eventType: 'skill.deleted.restored',
          beforeData: skill,
          afterData: updated,
          metadata: {
            bindingsRestored: false,
            installationsRestored: false,
          },
        },
        tx,
      );

      return toSkillApiJson(updated);
    });
  }

  async restoreVersion(
    userId: string,
    skillId: string,
    sourceVersionId: string,
  ) {
    return this.versions.restore(userId, skillId, sourceVersionId);
  }

  async install(userId: string, skillId: string) {
    const skill = await this.access.readable(userId, skillId);
    if (
      skill.status !== SkillStatus.ACTIVE ||
      skill.securityState !== SkillSecurityState.CLEAR
    )
      throw new ConflictException("ONLY_ACTIVE_CLEAR_SKILL_CAN_BE_INSTALLED");
    const installation = await this.repository
      .client()
      .skillInstallation.upsert({
        where: {
          scopeType_scopeId_skillId: {
            scopeType: "USER",
            scopeId: userId,
            skillId,
          },
        },
        create: {
          skillId,
          scopeType: "USER",
          scopeId: userId,
          installedByUserId: userId,
          status: SkillInstallationStatus.INSTALLED,
          enabled: true,
        },
        update: {
          status: SkillInstallationStatus.INSTALLED,
          enabled: true,
          removedAt: null,
        },
      });
    await this.audit.write({
      skillId,
      actorUserId: userId,
      eventType: "skill.installed",
      afterData: installation,
    });
    return installation;
  }

  async uninstall(userId: string, skillId: string) {
    const installation = await this.repository
      .client()
      .skillInstallation.findUnique({
        where: {
          scopeType_scopeId_skillId: {
            scopeType: "USER",
            scopeId: userId,
            skillId,
          },
        },
      });
    if (!installation)
      throw new NotFoundException("SKILL_INSTALLATION_NOT_FOUND");
    const updated = await this.repository
      .client()
      .skillInstallation.update({
        where: { id: installation.id },
        data: {
          status: SkillInstallationStatus.UNINSTALLED,
          enabled: false,
          removedAt: new Date(),
        },
      });
    await this.audit.write({
      skillId,
      actorUserId: userId,
      eventType: "skill.uninstalled",
      beforeData: installation,
      afterData: updated,
    });
    return updated;
  }
}
