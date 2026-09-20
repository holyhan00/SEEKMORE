import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SkillFileType,
  SkillVersionStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  sha256,
  skillPackageChecksum,
} from '../domain/skill-content.util';
import { SKILL_PACKAGE_LIMITS } from '../domain/skill-policy';
import { SkillAccessService } from '../application/skill-access.service';
import { SkillPathPolicy } from '../security/skill-path-policy';
import { SkillRepository } from '../persistence/skill.repository';
import {
  SKILL_FILE_STORAGE,
  type SkillFileStoragePort,
} from './skill-file-storage.port';
import { SkillAuditService } from '../usage/skill-audit.service';
import { toSkillApiJson } from '../domain/skill-json.util';
import { SkillFrontmatterParser } from '../validation/skill-frontmatter.parser';
import { SkillDocumentValidator } from '../validation/skill-document.validator';

type VersionSnapshot =
  Prisma.SkillVersionGetPayload<{
    include: {
      files: true;
      schemas: true;
      dependencies: true;
      toolBindings: true;
      mcpBindings: true;
    };
  }>;

interface SkillFileUploadRequest {
  file: Express.Multer.File;
  rawPath: string;
  requestedType?: SkillFileType;
}

interface PreparedSkillFileUpload {
  file: Express.Multer.File;
  path: string;
  fileType: SkillFileType;
  mimeType: string;
  textContent: string | null;
  checksum: string;
  sizeBytes: number;
  executable: boolean;
  storageKey?: string;
}

@Injectable()
export class SkillFileService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly paths: SkillPathPolicy,
    @Inject(SKILL_FILE_STORAGE)
    private readonly storage: SkillFileStoragePort,
    private readonly audit: SkillAuditService,
    private readonly parser: SkillFrontmatterParser,
    private readonly validator: SkillDocumentValidator,
  ) {}

  async list(
    userId: string,
    skillId: string,
    versionId: string,
  ) {
    await this.access.readable(
      userId,
      skillId,
    );

    return toSkillApiJson(
      await this.repository
        .client()
        .skillFile.findMany({
          where: {
            skillVersionId: versionId,
            version: { skillId },
          },
          orderBy: { path: 'asc' },
        }),
    );
  }

  async upload(
    userId: string,
    skillId: string,
    versionId: string,
    file: Express.Multer.File,
    rawPath: string,
    requestedType?: SkillFileType,
  ) {
    const result = await this.uploadMany(
      userId,
      skillId,
      versionId,
      [
        {
          file,
          rawPath,
          requestedType,
        },
      ],
    );

    return toSkillApiJson({
      version: result.version,
      file: result.files[0],
    });
  }

  async uploadMany(
    userId: string,
    skillId: string,
    versionId: string,
    requests: SkillFileUploadRequest[],
  ) {
    if (
      !Array.isArray(requests) ||
      requests.length === 0
    ) {
      throw new BadRequestException(
        'SKILL_FILES_REQUIRED',
      );
    }

    const skill =
      await this.access.manageable(
        userId,
        skillId,
      );

    if (skill.deletedAt) {
      throw new ConflictException(
        'SKILL_DELETED',
      );
    }

    const source = await this.snapshot(
      skillId,
      versionId,
    );

    this.assertDraftReplacementAllowed(
      source,
    );

    const prepared =
      this.prepareUploads(requests);

    this.assertUploadPackageLimits(
      source,
      prepared,
    );

    this.assertResultingPackageValid(
      source,
      this.resultingFilesAfterUpload(
        source,
        prepared,
      ),
    );

    const nextVersionId = randomUUID();
    const savedStorageKeys: string[] = [];

    try {
      for (const item of prepared) {
        const storageKey =
          await this.storage.save({
            skillId,
            versionId: nextVersionId,
            path: item.path,
            buffer: item.file.buffer,
          });

        item.storageKey = storageKey;
        savedStorageKeys.push(storageKey);
      }

      return await this.repository.transaction(
        async (tx) => {
          const locked =
            await tx.skillVersion.findFirst({
              where: {
                id: source.id,
                skillId,
                revision: source.revision,
              },
              include: {
                files: true,
                schemas: true,
                dependencies: true,
                toolBindings: true,
                mcpBindings: true,
              },
            });

          if (!locked) {
            throw new ConflictException(
              'SKILL_VERSION_REVISION_CONFLICT',
            );
          }

          this.assertDraftReplacementAllowed(
            locked,
          );

          this.assertUploadPackageLimits(
            locked,
            prepared,
          );

          const incomingPaths = new Set(
            prepared.map((item) => item.path),
          );

          const remaining =
            locked.files.filter(
              (item) =>
                !incomingPaths.has(item.path),
            );

          this.assertResultingPackageValid(
            locked,
            [
              ...remaining,
              ...prepared,
            ],
          );

          const packageChecksum =
            skillPackageChecksum(
              locked.skillMarkdown,
              [
                ...remaining.map((item) => ({
                  path: item.path,
                  checksum: item.checksum,
                })),
                ...prepared.map((item) => ({
                  path: item.path,
                  checksum: item.checksum,
                })),
              ],
            );

          const version =
            await this.createRevision(tx, {
              source: locked,
              id: nextVersionId,
              userId,
              packageChecksum,
              changeLog:
                prepared.length === 1
                  ? `Updated resource ${prepared[0].path}`
                  : `Updated ${prepared.length} resources`,
            });

          if (remaining.length) {
            await tx.skillFile.createMany({
              data: remaining.map((item) =>
                this.fileClone(
                  version.id,
                  item,
                ),
              ),
            });
          }

          const created: Array<
  VersionSnapshot['files'][number]
> = [];

          for (const item of prepared) {
            const storageKey = item.storageKey;

            if (!storageKey) {
              throw new Error(
                'SKILL_FILE_STORAGE_KEY_REQUIRED',
              );
            }

            created.push(
              await tx.skillFile.create({
                data: {
                  skillVersionId: version.id,
                  path: item.path,
                  fileType: item.fileType,
                  mimeType: item.mimeType,
                  storageKey,
                  textContent:
                    item.textContent,
                  checksum: item.checksum,
                  sizeBytes: BigInt(
                    item.sizeBytes,
                  ),
                  executable:
                    item.executable,
                },
              }),
            );
          }

          await this.clonePlatformRelations(
            tx,
            locked,
            version.id,
          );

          await this.retireDraft(
            tx,
            locked,
          );

          const replacedPaths =
            locked.files
              .filter((item) =>
                incomingPaths.has(item.path),
              )
              .map((item) => item.path);

          await this.audit.write(
            {
              skillId,
              skillVersionId: version.id,
              actorUserId: userId,
              eventType:
                prepared.length === 1
                  ? replacedPaths.length
                    ? 'skill.file.replaced'
                    : 'skill.file.uploaded'
                  : 'skill.files.batch_uploaded',
              afterData: {
                paths: prepared.map(
                  (item) => item.path,
                ),
                replacedPaths,
                sourceVersionId: locked.id,
              },
            },
            tx,
          );

          return toSkillApiJson({
            version,
            files: created,
          });
        },
      );
    } catch (error) {
      await Promise.all(
        savedStorageKeys.map((storageKey) =>
          this.storage
            .remove(storageKey)
            .catch(() => undefined),
        ),
      );

      throw error;
    }
  }

  async remove(
    userId: string,
    skillId: string,
    versionId: string,
    fileId: string,
  ) {
    const result = await this.removeMany(
      userId,
      skillId,
      versionId,
      [fileId],
    );

    return toSkillApiJson({
      version: result.version,
    });
  }

  async removeMany(
    userId: string,
    skillId: string,
    versionId: string,
    rawFileIds: string[],
  ) {
    const fileIds = Array.from(
      new Set(
        (rawFileIds ?? [])
          .map((value) =>
            String(value ?? '').trim(),
          )
          .filter(Boolean),
      ),
    );

    if (fileIds.length === 0) {
      throw new BadRequestException(
        'SKILL_FILE_IDS_REQUIRED',
      );
    }

    const skill =
      await this.access.manageable(
        userId,
        skillId,
      );

    if (skill.deletedAt) {
      throw new ConflictException(
        'SKILL_DELETED',
      );
    }

    const source = await this.snapshot(
      skillId,
      versionId,
    );

    this.assertDraftReplacementAllowed(
      source,
    );

    const targetIds = new Set(fileIds);
    const targets = source.files.filter(
      (item) => targetIds.has(item.id),
    );

    if (targets.length !== fileIds.length) {
      throw new NotFoundException(
        'SKILL_FILE_NOT_FOUND',
      );
    }

    return this.repository.transaction(
      async (tx) => {
        const locked =
          await tx.skillVersion.findFirst({
            where: {
              id: source.id,
              skillId,
              revision: source.revision,
            },
            include: {
              files: true,
              schemas: true,
              dependencies: true,
              toolBindings: true,
              mcpBindings: true,
            },
          });

        if (!locked) {
          throw new ConflictException(
            'SKILL_VERSION_REVISION_CONFLICT',
          );
        }

        this.assertDraftReplacementAllowed(
          locked,
        );

        const lockedTargets =
          locked.files.filter((item) =>
            targetIds.has(item.id),
          );

        if (
          lockedTargets.length !==
          fileIds.length
        ) {
          throw new NotFoundException(
            'SKILL_FILE_NOT_FOUND',
          );
        }

        const remaining =
          locked.files.filter(
            (item) =>
              !targetIds.has(item.id),
          );

        this.assertResultingPackageValid(
          locked,
          remaining,
        );

        const packageChecksum =
          skillPackageChecksum(
            locked.skillMarkdown,
            remaining.map((item) => ({
              path: item.path,
              checksum: item.checksum,
            })),
          );

        const version =
          await this.createRevision(tx, {
            source: locked,
            id: randomUUID(),
            userId,
            packageChecksum,
            changeLog:
              lockedTargets.length === 1
                ? `Removed resource ${lockedTargets[0].path}`
                : `Removed ${lockedTargets.length} resources`,
          });

        if (remaining.length) {
          await tx.skillFile.createMany({
            data: remaining.map((item) =>
              this.fileClone(
                version.id,
                item,
              ),
            ),
          });
        }

        await this.clonePlatformRelations(
          tx,
          locked,
          version.id,
        );

        await this.retireDraft(
          tx,
          locked,
        );

        await this.audit.write(
          {
            skillId,
            skillVersionId: version.id,
            actorUserId: userId,
            eventType:
              lockedTargets.length === 1
                ? 'skill.file.deleted'
                : 'skill.files.batch_deleted',
            beforeData: {
              files: lockedTargets.map(
                (item) => ({
                  id: item.id,
                  path: item.path,
                  checksum: item.checksum,
                }),
              ),
            },
            afterData: {
              sourceVersionId: locked.id,
            },
          },
          tx,
        );

        return toSkillApiJson({
          version,
          removedFileIds: fileIds,
        });
      },
    );
  }

  async readContent(file: {
    storageKey: string | null;
    textContent: string | null;
    sizeBytes: bigint;
  }): Promise<string | null> {
    if (file.textContent !== null) {
      return file.textContent;
    }

    if (!file.storageKey) {
      return null;
    }

    const buffer = await this.storage.read(
      storageKeyOrThrow(file.storageKey),
      Number(file.sizeBytes),
    );

    return buffer.toString('utf8');
  }

  private prepareUploads(
    requests: SkillFileUploadRequest[],
  ): PreparedSkillFileUpload[] {
    if (
      requests.length >
      SKILL_PACKAGE_LIMITS.maxFiles
    ) {
      throw new ConflictException(
        'SKILL_FILE_COUNT_EXCEEDED',
      );
    }

    const seenPaths = new Set<string>();

    return requests.map((request) => {
      const file = request.file;

      if (!file?.buffer?.length) {
        throw new BadRequestException(
          'SKILL_FILE_REQUIRED',
        );
      }

      const normalizedPath =
        this.paths.normalize(
          request.rawPath ||
            file.originalname,
        );

      if (seenPaths.has(normalizedPath)) {
        throw new ConflictException(
          'SKILL_FILE_BATCH_PATH_DUPLICATE',
        );
      }

      seenPaths.add(normalizedPath);

      const fileType =
        (request.requestedType ??
          this.paths.classify(
            normalizedPath,
          )) as SkillFileType;

      this.assertSize(
        fileType,
        file.buffer.byteLength,
      );

      const mimeType =
        file.mimetype ||
        'application/octet-stream';

      return {
        file,
        path: normalizedPath,
        fileType,
        mimeType,
        textContent: this.isText(
          mimeType,
          normalizedPath,
        )
          ? file.buffer.toString('utf8')
          : null,
        checksum: sha256(file.buffer),
        sizeBytes: file.buffer.byteLength,
        executable:
          fileType === SkillFileType.SCRIPT,
      };
    });
  }

  private resultingFilesAfterUpload(
    source: VersionSnapshot,
    prepared: PreparedSkillFileUpload[],
  ) {
    const incomingPaths = new Set(
      prepared.map((item) => item.path),
    );

    return [
      ...source.files.filter(
        (item) =>
          !incomingPaths.has(item.path),
      ),
      ...prepared,
    ];
  }

  private snapshot(
    skillId: string,
    versionId: string,
  ): Promise<VersionSnapshot> {
    return this.repository
      .client()
      .skillVersion.findFirst({
        where: {
          id: versionId,
          skillId,
        },
        include: {
          files: true,
          schemas: true,
          dependencies: true,
          toolBindings: true,
          mcpBindings: true,
        },
      })
      .then((value) => {
        if (!value) {
          throw new NotFoundException(
            'SKILL_VERSION_NOT_FOUND',
          );
        }

        return value;
      });
  }

  private assertDraftReplacementAllowed(
    source: VersionSnapshot,
  ): void {
    if (
      source.status !==
      SkillVersionStatus.DRAFT
    ) {
      throw new ConflictException(
        'SKILL_RESOURCE_CHANGE_REQUIRES_DRAFT_VERSION',
      );
    }
  }

  private async createRevision(
    tx: Prisma.TransactionClient,
    input: {
      source: VersionSnapshot;
      id: string;
      userId: string;
      packageChecksum: string;
      changeLog: string;
    },
  ) {
    const latest =
      await tx.skillVersion.aggregate({
        where: {
          skillId: input.source.skillId,
        },
        _max: { versionNumber: true },
      });

    const versionNumber =
      (latest._max.versionNumber ?? 0) + 1;

    return tx.skillVersion.create({
      data: {
        id: input.id,
        skillId: input.source.skillId,
        versionNumber,
        versionLabel: `v${versionNumber}`,
        status: SkillVersionStatus.DRAFT,
        skillMarkdown:
          input.source.skillMarkdown,
        instructionBody:
          input.source.instructionBody,
        manifest:
          input.source
            .manifest as Prisma.InputJsonValue,
        compatibility:
          input.source.compatibility,
        validationPolicy:
          input.source
            .validationPolicy as Prisma.InputJsonValue,
        failurePolicy:
          input.source
            .failurePolicy as Prisma.InputJsonValue,
        executionPolicy:
          input.source
            .executionPolicy as Prisma.InputJsonValue,
        packageChecksum:
          input.packageChecksum,
        sourceRevision:
          input.source.sourceRevision,
        changeLog: input.changeLog,
        createdByUserId: input.userId,
      },
    });
  }

  private async clonePlatformRelations(
    tx: Prisma.TransactionClient,
    source: VersionSnapshot,
    versionId: string,
  ) {
    if (source.schemas.length) {
      await tx.skillConfigSchema.createMany({
        data: source.schemas.map((item) => ({
          skillVersionId: versionId,
          kind: item.kind,
          schema:
            item.schema as Prisma.InputJsonValue,
        })),
      });
    }

    if (source.dependencies.length) {
      await tx.skillDependency.createMany({
        data: source.dependencies.map(
          (item) => ({
            skillVersionId: versionId,
            dependencySkillId:
              item.dependencySkillId,
            versionConstraint:
              item.versionConstraint,
            required: item.required,
            reason: item.reason,
          }),
        ),
      });
    }

    if (source.toolBindings.length) {
      await tx.skillToolBinding.createMany({
        data: source.toolBindings.map(
          (item) => ({
            skillVersionId: versionId,
            toolName: item.toolName,
            versionConstraint:
              item.versionConstraint,
            capabilities: item.capabilities,
            required: item.required,
            configSchema:
              item.configSchema === null
                ? undefined
                : (item.configSchema as Prisma.InputJsonValue),
          }),
        ),
      });
    }

    if (source.mcpBindings.length) {
      await tx.skillMcpBinding.createMany({
        data: source.mcpBindings.map(
          (item) => ({
            skillVersionId: versionId,
            mcpServerId: item.mcpServerId,
            serverName: item.serverName,
            toolName: item.toolName,
            capability: item.capability,
            required: item.required,
          }),
        ),
      });
    }
  }

  private async retireDraft(
    tx: Prisma.TransactionClient,
    source: VersionSnapshot,
  ) {
    await tx.skillVersion.update({
      where: { id: source.id },
      data: {
        status: SkillVersionStatus.REJECTED,
        revision: { increment: 1 },
      },
    });
  }

  private fileClone(
    versionId: string,
    item: VersionSnapshot['files'][number],
  ) {
    return {
      skillVersionId: versionId,
      path: item.path,
      fileType: item.fileType,
      mimeType: item.mimeType,
      storageKey: item.storageKey,
      textContent: item.textContent,
      checksum: item.checksum,
      sizeBytes: item.sizeBytes,
      executable: item.executable,
    };
  }

  private assertResultingPackageValid(
    source: VersionSnapshot,
    files: Array<{
      path: string;
      fileType: SkillFileType;
      mimeType: string;
      textContent: string | null;
    }>,
  ): void {
    const parsed = this.parser.parse(
      source.skillMarkdown,
    );

    this.validator.assertValid(parsed, {
      existingName: parsed.manifest.name,
      resources: files.map((file) => ({
        path: file.path,
        fileType: file.fileType,
        mimeType: file.mimeType,
        buffer:
          file.textContent === null
            ? Buffer.alloc(0)
            : Buffer.from(
                file.textContent,
                'utf8',
              ),
      })),
    });
  }

  private assertUploadPackageLimits(
    source: VersionSnapshot,
    prepared: PreparedSkillFileUpload[],
  ): void {
    const resulting = new Map<
      string,
      number
    >();

    for (const item of source.files) {
      resulting.set(
        item.path,
        Number(item.sizeBytes),
      );
    }

    for (const item of prepared) {
      resulting.set(
        item.path,
        item.sizeBytes,
      );
    }

    if (
      resulting.size >
      SKILL_PACKAGE_LIMITS.maxFiles
    ) {
      throw new ConflictException(
        'SKILL_FILE_COUNT_EXCEEDED',
      );
    }

    const total = Array.from(
      resulting.values(),
    ).reduce(
      (sum, size) => sum + size,
      0,
    );

    if (
      total >
      SKILL_PACKAGE_LIMITS.maxPackageBytes
    ) {
      throw new ConflictException(
        'SKILL_PACKAGE_SIZE_EXCEEDED',
      );
    }
  }

  private assertSize(
    type: SkillFileType,
    size: number,
  ): void {
    const limit =
      type === SkillFileType.REFERENCE
        ? SKILL_PACKAGE_LIMITS.maxReferenceBytes
        : type === SkillFileType.SCRIPT
          ? SKILL_PACKAGE_LIMITS.maxScriptBytes
          : type === SkillFileType.ASSET
            ? SKILL_PACKAGE_LIMITS.maxAssetBytes
            : SKILL_PACKAGE_LIMITS.maxReferenceBytes;

    if (size > limit) {
      throw new ConflictException(
        'SKILL_FILE_SIZE_EXCEEDED',
      );
    }
  }

  private isText(
    mime: string,
    filePath: string,
  ): boolean {
    return (
      mime.startsWith('text/') ||
      /\.(?:md|txt|json|yaml|yml|csv|xml|html|css|js|mjs|ts|py|sh)$/i.test(
        filePath,
      )
    );
  }
}

function storageKeyOrThrow(
  value: string | null,
): string {
  if (!value) {
    throw new Error(
      'SKILL_FILE_STORAGE_KEY_REQUIRED',
    );
  }

  return value;
}
