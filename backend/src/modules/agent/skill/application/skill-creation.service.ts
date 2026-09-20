                                                                

import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  SkillActivationMode,
  SkillFileType,
  SkillSecurityState,
  SkillStatus,
  SkillVersionStatus,
  SkillVisibility,
} from '@prisma/client';
import { randomUUID } from 'crypto';

import type {
  ParsedSkillDocument,
  SkillDocumentDiagnostic,
  SkillDocumentValidationResult,
  SkillPackageInput,
  SkillPackageResourceInput,
} from '../domain/skill-document.types';
import { SkillDomainError } from '../domain/skill.errors';
import { resolveSkillIdentity } from '../domain/skill-identity.util';
import {
  sha256,
  skillPackageChecksum,
} from '../domain/skill-content.util';
import {
  toSkillApiJson,
  toSkillPrismaJson,
} from '../domain/skill-json.util';
import { SkillFileStorageService } from '../files/skill-file-storage.service';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillPackageScannerService } from '../security/skill-package-scanner.service';
import { SkillPathPolicy } from '../security/skill-path-policy';
import { SkillAuditService } from '../usage/skill-audit.service';
import { SkillAcceptancePolicy } from '../validation/skill-acceptance.policy';
import { SkillDocumentValidator } from '../validation/skill-document.validator';
import { SkillFrontmatterParser } from '../validation/skill-frontmatter.parser';

interface NormalizedResource {
  path: string;
  fileType: SkillFileType;
  mimeType: string;
  buffer: Buffer;
}

interface PreparedResource {
  path: string;
  fileType: SkillFileType;
  mimeType: string;
  checksum: string;
  sizeBytes: bigint;
  textContent: string | null;
  storageKey: string;
  executable: boolean;
}

@Injectable()
export class SkillCreationService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly parser: SkillFrontmatterParser,
    private readonly validator: SkillDocumentValidator,
    private readonly acceptance: SkillAcceptancePolicy,
    private readonly scanner: SkillPackageScannerService,
    private readonly paths: SkillPathPolicy,
    private readonly storage: SkillFileStorageService,
    private readonly audit: SkillAuditService,
  ) {}

  async create(userId: string, input: SkillPackageInput) {
    const resources = this.normalizeResources(
      input.resources ?? [],
    );

    const originalParsed = this.parseOrReject(
      input,
      [],
    );
    let identity: ReturnType<typeof resolveSkillIdentity>;

    try {
      identity = resolveSkillIdentity({
        parsed: originalParsed,
        skillMarkdown: input.skillMarkdown,
        displayName: input.displayName,
        preferredInternalName:
          input.preferredInternalName,
      });
    } catch (reason) {
      throw new BadRequestException({
        code: 'SKILL_DISPLAY_NAME_INVALID',
        field: 'displayName',
        message:
          reason instanceof Error &&
          reason.message === 'SKILL_DISPLAY_NAME_REQUIRED'
            ? 'Skill display name is required.'
            : 'Skill display name must not exceed 120 characters or contain control characters.',
      });
    }
    const normalizedInput: SkillPackageInput = {
      ...input,
      displayName: identity.displayName,
      preferredInternalName:
        identity.internalName,
      skillMarkdown: identity.skillMarkdown,
    };
    const parsed = identity.rewritten
      ? this.parseOrReject(normalizedInput, [])
      : originalParsed;

    const securityDiagnostics = this.scanner.scan(
      normalizedInput.skillMarkdown,
      resources.map((resource) => ({
        path: resource.path,
        sizeBytes: resource.buffer.byteLength,
        mimeType: resource.mimeType,
        fileType: resource.fileType,
        textContent: this.isText(
          resource.mimeType,
          resource.path,
        )
          ? resource.buffer.toString('utf8')
          : null,
      })),
    );

    const validation = this.validator.validate(parsed, {
      rootName:
        identity.rewritten
          ? identity.internalName
          : input.rootName?.trim() ||
            identity.internalName,
      resources,
    });
    const decision = this.acceptance.decide({
      source: input.source,
      report: validation,
      securityDiagnostics,
    });

    if (!decision.accepted || !validation.projection) {
      throw new BadRequestException({
        code: 'SKILL_PACKAGE_REJECTED',
        message:
          input.source === 'AI_GENERATED'
            ? 'AI-generated SKILL.md must be fully standard compliant.'
            : 'Skill package cannot be safely created or run.',
        validation: decision,
        issues: decision.blockingDiagnostics,
      });
    }

    const projection = validation.projection;
    const name = identity.internalName;
    const displayName = identity.displayName;
    const namespaceKey = `user:${userId}`;

    await this.assertNameAvailable(
      namespaceKey,
      name,
    );

    const skillId = randomUUID();
    const versionId = randomUUID();
    const preparedResources: PreparedResource[] = [];
    let transactionCommitted = false;

    try {
      for (const resource of resources) {
        const storageKey = await this.storage.save({
          skillId,
          versionId,
          path: resource.path,
          buffer: resource.buffer,
        });

        preparedResources.push({
          path: resource.path,
          fileType: resource.fileType,
          mimeType: resource.mimeType,
          checksum: sha256(resource.buffer),
          sizeBytes: BigInt(
            resource.buffer.byteLength,
          ),
          textContent: this.isText(
            resource.mimeType,
            resource.path,
          )
            ? resource.buffer.toString('utf8')
            : null,
          storageKey,
          executable:
            resource.fileType ===
            SkillFileType.SCRIPT,
        });
      }

      const packageChecksum = skillPackageChecksum(
        normalizedInput.skillMarkdown,
        preparedResources,
      );

      const provenance = toSkillPrismaJson({
        ...(input.provenance ?? {}),
        creationMethod: input.source,
        validationMode: decision.mode,
        specCompliant:
          validation.specCompliant,
        validation: decision,
      });

      const manifest = toSkillPrismaJson(
        parsed.frontmatter,
      );

      const created =
        await this.repository.transaction(
          async (tx) => {
            await this.assertNameAvailable(
              namespaceKey,
              name,
              tx,
            );

            await tx.skill.create({
              data: {
                id: skillId,
                ownerUserId: userId,
                createdByUserId: userId,
                namespaceKey,
                name,
                displayName,
                slug: name,
                description:
                  projection.description,
                activationDescription:
                  projection.description,
                category: input.category?.trim() || null,
                tags: [...new Set((input.tags ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 50),
                platforms: [],
                visibility:
                  SkillVisibility.PRIVATE,
                defaultActivationMode:
                  SkillActivationMode.AUTOMATIC,
                status: SkillStatus.DRAFT,
                securityState:
                  SkillSecurityState.REVIEW_REQUIRED,
                source: {
                  create: {
                    kind: input.sourceKind,
                    sourceRef:
                      input.sourceRef?.trim() ||
                      null,
                    sourceRevision:
                      input.sourceRevision?.trim() ||
                      null,
                    provenance,
                    lockData:
                      toSkillPrismaJson({}),
                    checksum: packageChecksum,
                  },
                },
              },
            });

            await tx.skillVersion.create({
              data: {
                id: versionId,
                skillId,
                versionNumber: 1,
                versionLabel: 'v1',
                status:
                  SkillVersionStatus.DRAFT,
                skillMarkdown:
                  normalizedInput.skillMarkdown,
                instructionBody:
                  parsed.bodyRaw,
                manifest,
                compatibility:
                  projection.compatibility ??
                  null,
                validationPolicy:
                  toSkillPrismaJson({}),
                failurePolicy:
                  toSkillPrismaJson({}),
                executionPolicy:
                  toSkillPrismaJson({}),
                packageChecksum,
                sourceRevision:
                  input.sourceRevision?.trim() ||
                  null,
                routingProfile: toSkillPrismaJson(input.routingProfile ?? {}),
                growProvenance: toSkillPrismaJson(input.growProvenance ?? {}),
                createdByUserId: userId,
              },
            });

            if (
              preparedResources.length > 0
            ) {
              await tx.skillFile.createMany({
                data: preparedResources.map(
                  (resource) => ({
                    skillVersionId: versionId,
                    path: resource.path,
                    fileType:
                      resource.fileType,
                    mimeType:
                      resource.mimeType,
                    storageKey:
                      resource.storageKey,
                    textContent:
                      resource.textContent,
                    checksum:
                      resource.checksum,
                    sizeBytes:
                      resource.sizeBytes,
                    executable:
                      resource.executable,
                  }),
                ),
              });
            }

            await this.audit.write(
              {
                skillId,
                skillVersionId: versionId,
                actorUserId: userId,
                eventType: 'skill.created',
                afterData: {
                  name,
                  displayName,
                  version: 'v1',
                  creationMethod:
                    input.source,
                  packageChecksum,
                  validationMode:
                    decision.mode,
                  specCompliant:
                    validation.specCompliant,
                },
              },
              tx,
            );

            const reloaded =
              await tx.skill.findUnique({
                where: { id: skillId },
                include: {
                  currentVersion: {
                    include: {
                      files: {
                        orderBy: {
                          path: 'asc',
                        },
                      },
                    },
                  },
                  source: true,
                  versions: {
                    orderBy: {
                      versionNumber: 'desc',
                    },
                    include: {
                      files: {
                        orderBy: {
                          path: 'asc',
                        },
                      },
                    },
                  },
                },
              });

            if (!reloaded) {
              throw new Error(
                'SKILL_CREATE_RELOAD_FAILED',
              );
            }

            return reloaded;
          },
        );

      transactionCommitted = true;

      return toSkillApiJson({
        ...created,
        creationMethod: input.source,
        diagnostics: decision.diagnostics,
        validation: decision,
      });
    } catch (error) {
      const persisted =
        transactionCommitted ||
        (await this.isSkillPersisted(skillId));

      if (!persisted) {
        await this.removePreparedResources(
          preparedResources,
        );
      }

      if (
        this.isNamespaceNameConstraintError(
          error,
        )
      ) {
        throw new ConflictException({
          code: 'SKILL_NAME_CONFLICT',
          field: 'name',
          message: `A Skill named ${name} already exists in this namespace.`,
        });
      }

      throw error;
    }
  }

  private parseOrReject(
    input: SkillPackageInput,
    securityDiagnostics: SkillDocumentDiagnostic[],
  ): ParsedSkillDocument {
    try {
      return this.parser.parse(input.skillMarkdown);
    } catch (error) {
      if (!(error instanceof SkillDomainError)) {
        throw error;
      }

      const diagnostic = this.parseDiagnostic(error);
      const report: SkillDocumentValidationResult = {
        valid: false,
        parseable: false,
        runnable: false,
        specCompliant: false,
        projection: null,
        diagnostics: [diagnostic],
      };
      const decision = this.acceptance.decide({
        source: input.source,
        report,
        securityDiagnostics,
      });

      throw new BadRequestException({
        code: 'SKILL_PACKAGE_REJECTED',
        message: 'SKILL.md could not be parsed.',
        validation: decision,
        issues: decision.blockingDiagnostics,
      });
    }
  }

  private parseDiagnostic(
    error: SkillDomainError,
  ): SkillDocumentDiagnostic {
    const details =
      error.details &&
      typeof error.details === 'object' &&
      !Array.isArray(error.details)
        ? (error.details as Record<string, unknown>)
        : {};

    return {
      code: error.code,
      severity: 'ERROR',
      message: error.message,
      path: 'SKILL.md',
      line:
        typeof details.line === 'number'
          ? details.line
          : null,
      column:
        typeof details.column === 'number'
          ? details.column
          : null,
    };
  }

  private async assertNameAvailable(
    namespaceKey: string,
    name: string,
    client:
      | Prisma.TransactionClient
      | ReturnType<SkillRepository['client']> =
      this.repository.client(),
  ): Promise<void> {
    const conflict =
      await client.skill.findFirst({
        where: {
          namespaceKey,
          slug: name,
        },
        select: {
          id: true,
          deletedAt: true,
        },
      });

    if (conflict?.deletedAt) {
      throw new ConflictException({
        code: 'SKILL_NAME_RESERVED',
        field: 'name',
        message:
          'A deleted Skill with this name is retained until permanent deletion.',
      });
    }

    if (conflict) {
      throw new ConflictException({
        code: 'SKILL_NAME_CONFLICT',
        field: 'name',
        message: `A Skill named ${name} already exists in this namespace.`,
      });
    }
  }

  private normalizeResources(
    resources: SkillPackageResourceInput[],
  ): NormalizedResource[] {
    const seen = new Set<string>();

    return resources.map((resource) => {
      if (!Buffer.isBuffer(resource.buffer)) {
        throw new BadRequestException({
          code: 'SKILL_RESOURCE_CONTENT_INVALID',
          path: resource.path,
          message:
            'Skill resource content must be a Buffer.',
        });
      }

      const normalizedPath =
        this.paths.normalize(resource.path);
      const collisionKey =
        normalizedPath.toLowerCase();

      if (collisionKey === 'skill.md') {
        throw new BadRequestException({
          code: 'SKILL_ROOT_DOCUMENT_DUPLICATED',
          path: normalizedPath,
          message:
            'The root SKILL.md must be provided as skillMarkdown, not as a resource.',
        });
      }

      if (seen.has(collisionKey)) {
        throw new BadRequestException({
          code: 'SKILL_DUPLICATE_PATH',
          path: normalizedPath,
          message:
            'Skill package contains duplicate or case-conflicting paths.',
        });
      }
      seen.add(collisionKey);

      const classifiedType =
        this.fileType(normalizedPath);
      if (
        resource.fileType !== undefined &&
        resource.fileType !== classifiedType
      ) {
        throw new BadRequestException({
          code: 'SKILL_RESOURCE_TYPE_MISMATCH',
          path: normalizedPath,
          message:
            'Skill resource type does not match its package-relative path.',
        });
      }

      return {
        path: normalizedPath,
        fileType: classifiedType,
        mimeType:
          String(resource.mimeType ?? '').trim() ||
          'application/octet-stream',
        buffer: resource.buffer,
      };
    });
  }

  private async removePreparedResources(
    resources: PreparedResource[],
  ): Promise<void> {
    await Promise.all(
      resources.map((resource) =>
        this.storage
          .remove(resource.storageKey)
          .catch(() => undefined),
      ),
    );
  }

  private async isSkillPersisted(
    skillId: string,
  ): Promise<boolean> {
    try {
      const persisted =
        await this.repository.client().skill.findUnique({
          where: { id: skillId },
          select: { id: true },
        });
      return Boolean(persisted);
    } catch {
      return true;
    }
  }

  private isNamespaceNameConstraintError(
    error: unknown,
  ): boolean {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      (error as { code?: unknown }).code !==
        'P2002'
    ) {
      return false;
    }

    const target = (
      error as {
        meta?: { target?: unknown };
      }
    ).meta?.target;

    if (target === undefined || target === null) {
      return true;
    }

    const fields = Array.isArray(target)
      ? target.map(String)
      : [String(target)];
    const joined = fields
      .join(',')
      .toLowerCase();

    return (
      joined.includes(
        'uq_skill_namespace_slug',
      ) ||
      (joined.includes('namespace') &&
        joined.includes('slug'))
    );
  }

  private fileType(
    filePath: string,
  ): SkillFileType {
    return this.paths.classify(
      filePath,
    ) as SkillFileType;
  }

  private isText(
    mimeType: string,
    filePath: string,
  ): boolean {
    return (
      mimeType.startsWith('text/') ||
      /\.(?:md|txt|json|yaml|yml|csv|xml|html|css|js|mjs|cjs|jsx|ts|tsx|py|sh|bash|zsh|ps1|rb|php|java|kt|kts|go|rs|swift|c|h|cc|cpp|hpp|toml|ini|properties|sql)$/i.test(
        filePath,
      )
    );
  }
}
