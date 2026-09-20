import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SkillSecurityState,
  SkillStatus,
  SkillValidationStatus,
  SkillVersionStatus,
} from '@prisma/client';
import { SkillAccessService } from '../application/skill-access.service';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillFrontmatterParser } from './skill-frontmatter.parser';
import { SkillDocumentValidator } from './skill-document.validator';
import { SkillPackageScannerService } from '../security/skill-package-scanner.service';
import { SkillDependencyResolverService } from '../runtime/skill-dependency-resolver.service';
import { SkillCapabilityResolverService } from '../capability/skill-capability-resolver.service';
import type { SkillValidationIssue, SkillValidationResult } from '../domain/skill.types';
import { SkillAuditService } from '../usage/skill-audit.service';

@Injectable()
export class SkillValidationService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly parser: SkillFrontmatterParser,
    private readonly documentValidator: SkillDocumentValidator,
    private readonly scanner: SkillPackageScannerService,
    private readonly dependencies: SkillDependencyResolverService,
    private readonly capabilities: SkillCapabilityResolverService,
    private readonly audit: SkillAuditService,
  ) {}

  async validate(
    userId: string,
    skillId: string,
    versionId?: string,
  ): Promise<SkillValidationResult & { validationRunId: string; versionId: string }> {
    const skill = await this.access.manageable(userId, skillId);
    const version = versionId
      ? await this.repository.client().skillVersion.findFirst({
          where: { id: versionId, skillId },
          include: { files: true },
        })
      : await this.repository.client().skillVersion.findFirst({
          where: { skillId, status: SkillVersionStatus.DRAFT },
          orderBy: { versionNumber: 'desc' },
          include: { files: true },
        });
    if (!version) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');

    const run = await this.repository.client().skillValidationRun.create({
      data: {
        skillVersionId: version.id,
        status: SkillValidationStatus.RUNNING,
        scannerVersion: 'agent-skills-validator/1',
        packageChecksum: version.packageChecksum,
        requestedByUserId: userId,
        startedAt: new Date(),
      },
    });

    if (!skill.currentVersionId) {
      await this.repository.client().skill.update({
        where: { id: skillId },
        data: { status: SkillStatus.VALIDATING },
      });
    }
    await this.repository.client().skillVersion.update({
      where: { id: version.id },
      data: { status: SkillVersionStatus.VALIDATING },
    });

    let structuralIssues: SkillValidationIssue[] = [];
    try {
      const parsed = this.parser.parse(version.skillMarkdown);
      const result = this.documentValidator.validate(parsed, {
        rootName: skill.name,
        resources: version.files.map((file) => ({
          path: file.path,
          fileType: file.fileType,
          mimeType: file.mimeType,
          buffer: file.textContent ? Buffer.from(file.textContent, 'utf8') : Buffer.alloc(0),
        })),
      });
      structuralIssues = result.diagnostics;
      if (parsed.manifest.name !== skill.name) {
        structuralIssues.push({
          code: 'SKILL_NAME_IMMUTABLE',
          severity: 'ERROR',
          field: 'name',
          path: 'SKILL.md',
          message: 'An existing Skill cannot change its name.',
        });
      }
    } catch (error) {
      structuralIssues = [{
        code: 'SKILL_DOCUMENT_PARSE_FAILED',
        severity: 'ERROR',
        path: 'SKILL.md',
        message: error instanceof Error ? error.message : String(error),
      }];
    }

    const securityIssues = this.scanner.scan(
      version.skillMarkdown,
      version.files.map((file) => ({
        path: file.path,
        sizeBytes: Number(file.sizeBytes),
        mimeType: file.mimeType,
        fileType: file.fileType,
        textContent: file.textContent,
      })),
    );

    const dependencyStatus = await this.dependencies.resolve(version.id);
    const dependencyIssues = dependencyStatus.items
      .filter((item) => item.required && (!item.available || !item.permitted))
      .map((item): SkillValidationIssue => ({
        code: `SKILL_${item.kind}_DEPENDENCY_UNAVAILABLE`,
        severity: 'ERROR',
        path: null,
        message: `${item.kind} dependency is unavailable: ${item.key}`,
        params: { kind: item.kind, key: item.key },
      }));

    const capabilityStatus = this.capabilities.inspectPolicy(version.executionPolicy);
    const capabilityIssues: SkillValidationIssue[] = capabilityStatus.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      path: issue.capabilityId
        ? `executionPolicy.capabilityRequirements.${issue.capabilityId}`
        : 'executionPolicy.capabilityResolutions',
      message: issue.message,
      ...(issue.params ? { params: issue.params } : {}),
    }));

    const all = [
      ...structuralIssues,
      ...securityIssues,
      ...dependencyIssues,
      ...capabilityIssues,
    ];
    const valid = !all.some(
      (issue) => issue.severity === 'ERROR' || issue.severity === 'CRITICAL',
    );

    const structuralResult: Prisma.InputJsonValue = {
      issues: structuralIssues.map((issue) => this.issueJson(issue)),
    };
    const securityResult: Prisma.InputJsonValue = {
      issues: securityIssues.map((issue) => this.issueJson(issue)),
    };
    const dependencyResult: Prisma.InputJsonValue = {
      status: {
        satisfied: dependencyStatus.satisfied,
        items: dependencyStatus.items.map((item) => ({
          kind: item.kind,
          key: item.key,
          required: item.required,
          available: item.available,
          permitted: item.permitted,
          reason: item.reason,
        })),
      },
      issues: dependencyIssues.map((issue) => this.issueJson(issue)),
      capabilities: {
        ready: capabilityStatus.ready,
        requirements: capabilityStatus.requirements.map((item) => ({
          capabilityId: item.capabilityId,
          required: item.required,
          reason: item.reason,
          confirmationRequired: item.confirmationRequired,
        })),
        resolutions: capabilityStatus.resolutions.map((item) => ({
          rawValue: item.rawValue,
          capabilityId: item.capabilityId,
          status: item.status,
          candidates: item.candidates,
          required: item.required,
          reason: item.reason,
          confirmationRequired: item.confirmationRequired,
        })),
        issues: capabilityIssues.map((issue) => this.issueJson(issue)),
      },
    };
    const diagnostics: Prisma.InputJsonValue = all.map((issue) => this.issueJson(issue));

    await this.repository.transaction(async (tx) => {
      await tx.skillValidationRun.update({
        where: { id: run.id },
        data: {
          status: valid ? SkillValidationStatus.PASSED : SkillValidationStatus.FAILED,
          structuralResult,
          securityResult,
          dependencyResult,
          diagnostics,
          finishedAt: new Date(),
        },
      });
      await tx.skillVersion.update({
        where: { id: version.id },
        data: { status: SkillVersionStatus.DRAFT },
      });
      const hasPublishedCurrent = Boolean(skill.currentVersionId);
      const criticalSecurity = securityIssues.some(
        (issue) => issue.severity === 'CRITICAL',
      );
      await tx.skill.update({
        where: { id: skillId },
        data: {
          status: hasPublishedCurrent
            ? skill.status
            : valid
              ? SkillStatus.DRAFT
              : SkillStatus.REJECTED,
          securityState: hasPublishedCurrent
            ? skill.securityState
            : valid
              ? SkillSecurityState.CLEAR
              : criticalSecurity
                ? SkillSecurityState.QUARANTINED
                : SkillSecurityState.REVIEW_REQUIRED,
          lastValidatedAt: new Date(),
          ...(!hasPublishedCurrent && criticalSecurity
            ? {
                quarantinedAt: new Date(),
                quarantineReason: securityIssues
                  .filter((issue) => issue.severity === 'CRITICAL')
                  .map((issue) => issue.code)
                  .join(','),
              }
            : {}),
        },
      });
      await this.audit.write({
        skillId,
        skillVersionId: version.id,
        actorUserId: userId,
        eventType: valid ? 'skill.validation.passed' : 'skill.validation.failed',
        severity: valid ? 'info' : 'warning',
        afterData: { valid, issues: all },
      }, tx);
    });

    return {
      valid,
      packageChecksum: version.packageChecksum,
      structuralIssues,
      securityIssues,
      dependencyIssues,
      capabilityIssues,
      validationRunId: run.id,
      versionId: version.id,
    };
  }

  private issueJson(issue: SkillValidationIssue): Prisma.InputJsonObject {
    return {
      code: issue.code,
      severity: issue.severity,
      path: issue.path,
      message: issue.message,
      ...(issue.params ? { params: issue.params } : {}),
    };
  }
}
