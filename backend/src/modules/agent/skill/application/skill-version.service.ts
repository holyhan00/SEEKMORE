import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SkillFileType, SkillSourceKind, SkillVersionStatus } from '@prisma/client';
import type {
  CreateSkillVersionDto,
  UpdateSkillVersionDto,
} from '../api/dto/skill.dto';
import { sha256, skillPackageChecksum } from '../domain/skill-content.util';
import { normalizeSkillDisplayName } from '../domain/skill-identity.util';
import { SkillAccessService } from './skill-access.service';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillFrontmatterParser } from '../validation/skill-frontmatter.parser';
import { SkillDocumentValidator } from '../validation/skill-document.validator';
import { SkillAuditService } from '../usage/skill-audit.service';

const VERSION_INCLUDE = {
  files: true,
  schemas: true,
  dependencies: true,
  toolBindings: true,
  mcpBindings: true,
} satisfies Prisma.SkillVersionInclude;

type VersionSnapshot = Prisma.SkillVersionGetPayload<{
  include: typeof VERSION_INCLUDE;
}>;


export interface CreateAutomatedSkillVersionInput {
  baseVersionId: string;
  basePackageChecksum: string;
  skillMarkdown?: string;
  changeLog?: string | null;
  resources?: Array<{
    path: string;
    mimeType: string;
    textContent: string;
    executable?: boolean;
  }>;
  routingProfile?: Record<string, unknown>;
  growProvenance: Record<string, unknown>;
}

@Injectable()
export class SkillVersionService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly parser: SkillFrontmatterParser,
    private readonly validator: SkillDocumentValidator,
    private readonly audit: SkillAuditService,
  ) {}

  async createDraft(userId: string, skillId: string, dto: CreateSkillVersionDto) {
    const skill = await this.access.manageable(userId, skillId);
    this.assertNotDeleted(skill.deletedAt);

    return this.repository.transaction(async (tx) => {
      const existingDraft = await tx.skillVersion.findFirst({
        where: { skillId, status: SkillVersionStatus.DRAFT },
        orderBy: { versionNumber: 'desc' },
      });
      if (existingDraft) throw new ConflictException('SKILL_DRAFT_ALREADY_EXISTS');

      const source = await tx.skillVersion.findFirst({
        where: skill.currentVersionId
          ? { id: skill.currentVersionId, skillId }
          : { skillId },
        orderBy: { versionNumber: 'desc' },
        include: VERSION_INCLUDE,
      });
      if (!source) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');

      return this.cloneVersion(
        tx,
        userId,
        skillId,
        skill.name,
        source,
        dto.skillMarkdown,
        dto.changeLog?.trim() || null,
        dto,
      );
    });
  }

  async updateDraft(
    userId: string,
    skillId: string,
    versionId: string,
    dto: UpdateSkillVersionDto,
  ) {
    const skill = await this.access.manageable(userId, skillId);
    this.assertNotDeleted(skill.deletedAt);

    return this.repository.transaction(async (tx) => {
      const source = await tx.skillVersion.findFirst({
        where: { id: versionId, skillId },
        include: VERSION_INCLUDE,
      });
      if (!source) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');
      if (source.status !== SkillVersionStatus.DRAFT) {
        throw new ConflictException('SKILL_VERSION_IMMUTABLE');
      }
      if (
        dto.expectedRevision !== undefined &&
        source.revision !== dto.expectedRevision
      ) {
        throw new ConflictException('SKILL_VERSION_REVISION_CONFLICT');
      }

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

      if (
        displayName !== undefined &&
        displayName !== skill.displayName
      ) {
        const updated = await tx.skill.updateMany({
          where: {
            id: skillId,
            deletedAt: null,
            ...(dto.expectedSkillRevision !== undefined
              ? { revision: dto.expectedSkillRevision }
              : {}),
          },
          data: {
            displayName,
            revision: { increment: 1 },
          },
        });

        if (updated.count !== 1) {
          throw new ConflictException('SKILL_REVISION_CONFLICT');
        }

        await this.audit.write(
          {
            skillId,
            actorUserId: userId,
            eventType: 'skill.settings.updated',
            beforeData: {
              displayName: skill.displayName,
              revision: skill.revision,
            },
            afterData: {
              displayName,
              revision: skill.revision + 1,
            },
          },
          tx,
        );
      }

      const next = await this.cloneVersion(
        tx,
        userId,
        skillId,
        skill.name,
        source,
        dto.skillMarkdown,
        dto.changeLog?.trim() || null,
        dto,
      );

      await tx.skillVersion.update({
        where: { id: source.id },
        data: { status: SkillVersionStatus.REJECTED, revision: { increment: 1 } },
      });

      await this.audit.write(
        {
          skillId,
          skillVersionId: next.id,
          actorUserId: userId,
          eventType: 'skill.version.replaced',
          beforeData: { versionId: source.id, version: source.versionLabel },
          afterData: { versionId: next.id, version: next.versionLabel },
        },
        tx,
      );

      return next;
    });
  }

  async createAutomatedDraft(
    userId: string,
    skillId: string,
    input: CreateAutomatedSkillVersionInput,
  ) {
    const skill = await this.access.manageable(userId, skillId);
    this.assertNotDeleted(skill.deletedAt);
    if (skill.ownerUserId !== userId) throw new ConflictException('SKILL_GROW_OWNER_REQUIRED');
    if (!skill.growEnabled || skill.growLocked) throw new ConflictException('SKILL_GROW_LOCKED');
    if (skill.source?.kind === SkillSourceKind.BUILTIN) {
      throw new ConflictException('SKILL_GROW_BUILTIN_PROTECTED');
    }

    return this.repository.transaction(async (tx) => {
      const existingDraft = await tx.skillVersion.findFirst({
        where: { skillId, status: SkillVersionStatus.DRAFT },
        select: { id: true },
      });
      if (existingDraft) throw new ConflictException('SKILL_DRAFT_ALREADY_EXISTS');

      const source = await tx.skillVersion.findFirst({
        where: { id: input.baseVersionId, skillId },
        include: VERSION_INCLUDE,
      });
      if (!source || skill.currentVersionId !== source.id) {
        throw new ConflictException('SKILL_GROW_BASE_VERSION_CHANGED');
      }
      if (source.packageChecksum !== input.basePackageChecksum) {
        throw new ConflictException('SKILL_GROW_BASE_CHECKSUM_CHANGED');
      }

      const markdown = input.skillMarkdown ?? source.skillMarkdown;
      const mergedFiles = new Map(source.files.map((file) => [file.path, {
        path: file.path,
        fileType: file.fileType,
        mimeType: file.mimeType,
        storageKey: file.storageKey,
        textContent: file.textContent,
        checksum: file.checksum,
        sizeBytes: file.sizeBytes,
        executable: file.executable,
      }]));
      for (const resource of input.resources ?? []) {
        const path = this.normalizeResourcePath(resource.path);
        const textContent = String(resource.textContent ?? '');
        mergedFiles.set(path, {
          path,
          fileType: this.fileType(path),
          mimeType: String(resource.mimeType ?? '').trim() || 'text/plain',
          storageKey: null,
          textContent,
          checksum: sha256(textContent),
          sizeBytes: BigInt(Buffer.byteLength(textContent, 'utf8')),
          executable: resource.executable === true,
        });
      }
      const files = [...mergedFiles.values()].sort((left, right) => left.path.localeCompare(right.path));
      const parsed = this.parser.parse(markdown);
      this.validator.assertValid(parsed, {
        rootName: skill.name,
        resources: files.map((file) => ({
          path: file.path,
          fileType: file.fileType,
          mimeType: file.mimeType,
          buffer: file.textContent ? Buffer.from(file.textContent, 'utf8') : Buffer.alloc(0),
        })),
      });
      if (parsed.manifest.name !== skill.name) {
        throw new ConflictException('SKILL_NAME_IMMUTABLE');
      }

      const latest = await tx.skillVersion.aggregate({
        where: { skillId },
        _max: { versionNumber: true },
      });
      const versionNumber = (latest._max.versionNumber ?? 0) + 1;
      const packageChecksum = skillPackageChecksum(markdown, files);
      const version = await tx.skillVersion.create({
        data: {
          skillId,
          versionNumber,
          versionLabel: `v${versionNumber}`,
          status: SkillVersionStatus.DRAFT,
          skillMarkdown: markdown,
          instructionBody: parsed.bodyRaw,
          manifest: parsed.frontmatter as Prisma.InputJsonValue,
          compatibility: parsed.manifest.compatibility ?? null,
          validationPolicy: source.validationPolicy as Prisma.InputJsonValue,
          failurePolicy: source.failurePolicy as Prisma.InputJsonValue,
          executionPolicy: source.executionPolicy as Prisma.InputJsonValue,
          packageChecksum,
          sourceRevision: source.sourceRevision,
          changeLog: input.changeLog?.trim() || null,
          routingProfile: (input.routingProfile ?? source.routingProfile ?? {}) as Prisma.InputJsonValue,
          growProvenance: input.growProvenance as Prisma.InputJsonValue,
          createdByUserId: userId,
        },
      });
      if (files.length) {
        await tx.skillFile.createMany({
          data: files.map((file) => ({
            skillVersionId: version.id,
            path: file.path,
            fileType: file.fileType,
            mimeType: file.mimeType,
            storageKey: file.storageKey,
            textContent: file.textContent,
            checksum: file.checksum,
            sizeBytes: file.sizeBytes,
            executable: file.executable,
          })),
        });
      }
      await this.cloneRelations(tx, source, version.id);
      await this.audit.write({
        skillId,
        skillVersionId: version.id,
        actorUserId: userId,
        eventType: 'skill.version.grow_created',
        afterData: {
          version: version.versionLabel,
          clonedFrom: source.id,
          packageChecksum,
          growProvenance: input.growProvenance,
        },
      }, tx);
      return version;
    });
  }

  async rejectDraft(userId: string, skillId: string, versionId: string, reason: string) {
    await this.access.manageable(userId, skillId);
    return this.repository.transaction(async (tx) => {
      const version = await tx.skillVersion.findFirst({ where: { id: versionId, skillId } });
      if (!version) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');
      if (version.status === SkillVersionStatus.PUBLISHED || version.status === SkillVersionStatus.SUPERSEDED) {
        throw new ConflictException('SKILL_VERSION_IMMUTABLE');
      }
      const rejected = await tx.skillVersion.update({
        where: { id: versionId },
        data: {
          status: SkillVersionStatus.REJECTED,
          changeLog: [version.changeLog, reason].filter(Boolean).join('\n'),
          revision: { increment: 1 },
        },
      });
      await this.audit.write({
        skillId,
        skillVersionId: versionId,
        actorUserId: userId,
        eventType: 'skill.version.grow_rejected',
        severity: 'warning',
        afterData: { reason },
      }, tx);
      return rejected;
    });
  }

  async restore(userId: string, skillId: string, sourceVersionId: string) {
    const skill = await this.access.manageable(userId, skillId);
    this.assertNotDeleted(skill.deletedAt);

    return this.repository.transaction(async (tx) => {
      const existingDraft = await tx.skillVersion.findFirst({
        where: { skillId, status: SkillVersionStatus.DRAFT },
        select: { id: true },
      });
      if (existingDraft) throw new ConflictException('SKILL_DRAFT_ALREADY_EXISTS');

      const source = await tx.skillVersion.findFirst({
        where: { id: sourceVersionId, skillId },
        include: VERSION_INCLUDE,
      });
      if (!source) throw new NotFoundException('SKILL_VERSION_NOT_FOUND');

      return this.cloneVersion(
        tx,
        userId,
        skillId,
        skill.name,
        source,
        source.skillMarkdown,
        `Restored from ${source.versionLabel}`,
        {},
      );
    });
  }

  private async cloneVersion(
    tx: Prisma.TransactionClient,
    userId: string,
    skillId: string,
    immutableSkillName: string,
    source: VersionSnapshot,
    markdown: string,
    changeLog: string | null,
    overrides: Pick<
      CreateSkillVersionDto,
      'validationPolicy' | 'failurePolicy' | 'executionPolicy'
    >,
  ) {
    const parsed = this.parser.parse(markdown);
    this.validator.assertValid(parsed, {
      rootName: immutableSkillName,
      resources: source.files.map((file) => ({
        path: file.path,
        fileType: file.fileType,
        mimeType: file.mimeType,
        buffer: file.textContent ? Buffer.from(file.textContent, 'utf8') : Buffer.alloc(0),
      })),
    });
    if (parsed.manifest.name !== immutableSkillName) {
      throw new ConflictException({
        code: 'SKILL_NAME_IMMUTABLE',
        field: 'name',
        message: 'An existing Skill cannot change its name. Create a new Skill instead.',
      });
    }

    const latestNumber = await tx.skillVersion.aggregate({
      where: { skillId },
      _max: { versionNumber: true },
    });
    const versionNumber = (latestNumber._max.versionNumber ?? 0) + 1;
    const packageChecksum = skillPackageChecksum(
      markdown,
      source.files.map((file) => ({
        path: file.path,
        checksum: file.checksum,
      })),
    );

    const version = await tx.skillVersion.create({
      data: {
        skillId,
        versionNumber,
        versionLabel: `v${versionNumber}`,
        status: SkillVersionStatus.DRAFT,
        skillMarkdown: markdown,
        instructionBody: parsed.bodyRaw,
        manifest: parsed.frontmatter as Prisma.InputJsonValue,
        compatibility: parsed.manifest.compatibility ?? null,
        validationPolicy: (overrides.validationPolicy ??
          source.validationPolicy) as Prisma.InputJsonValue,
        failurePolicy: (overrides.failurePolicy ??
          source.failurePolicy) as Prisma.InputJsonValue,
        executionPolicy: (overrides.executionPolicy ??
          source.executionPolicy) as Prisma.InputJsonValue,
        packageChecksum,
        sourceRevision: source.sourceRevision,
        changeLog,
        routingProfile: (source.routingProfile ?? {}) as Prisma.InputJsonValue,
        growProvenance: (source.growProvenance ?? {}) as Prisma.InputJsonValue,
        createdByUserId: userId,
      },
    });

    if (source.files.length) {
      await tx.skillFile.createMany({
        data: source.files.map((file) => ({
          skillVersionId: version.id,
          path: file.path,
          fileType: file.fileType,
          mimeType: file.mimeType,
          storageKey: file.storageKey,
          textContent: file.textContent,
          checksum: file.checksum,
          sizeBytes: file.sizeBytes,
          executable: file.executable,
        })),
      });
    }
    if (source.schemas.length) {
      await tx.skillConfigSchema.createMany({
        data: source.schemas.map((schema) => ({
          skillVersionId: version.id,
          kind: schema.kind,
          schema: schema.schema as Prisma.InputJsonValue,
        })),
      });
    }
    if (source.dependencies.length) {
      await tx.skillDependency.createMany({
        data: source.dependencies.map((dependency) => ({
          skillVersionId: version.id,
          dependencySkillId: dependency.dependencySkillId,
          versionConstraint: dependency.versionConstraint,
          required: dependency.required,
          reason: dependency.reason,
        })),
      });
    }
    if (source.toolBindings.length) {
      await tx.skillToolBinding.createMany({
        data: source.toolBindings.map((binding) => ({
          skillVersionId: version.id,
          toolName: binding.toolName,
          versionConstraint: binding.versionConstraint,
          capabilities: binding.capabilities,
          required: binding.required,
          configSchema:
            binding.configSchema === null
              ? undefined
              : (binding.configSchema as Prisma.InputJsonValue),
        })),
      });
    }
    if (source.mcpBindings.length) {
      await tx.skillMcpBinding.createMany({
        data: source.mcpBindings.map((binding) => ({
          skillVersionId: version.id,
          mcpServerId: binding.mcpServerId,
          serverName: binding.serverName,
          toolName: binding.toolName,
          capability: binding.capability,
          required: binding.required,
        })),
      });
    }

    await this.audit.write(
      {
        skillId,
        skillVersionId: version.id,
        actorUserId: userId,
        eventType: 'skill.version.created',
        afterData: {
          version: version.versionLabel,
          clonedFrom: source.id,
          packageChecksum,
        },
      },
      tx,
    );
    return version;
  }

  private async cloneRelations(
    tx: Prisma.TransactionClient,
    source: VersionSnapshot,
    versionId: string,
  ): Promise<void> {
    if (source.schemas.length) await tx.skillConfigSchema.createMany({
      data: source.schemas.map((item) => ({
        skillVersionId: versionId,
        kind: item.kind,
        schema: item.schema as Prisma.InputJsonValue,
      })),
    });
    if (source.dependencies.length) await tx.skillDependency.createMany({
      data: source.dependencies.map((item) => ({
        skillVersionId: versionId,
        dependencySkillId: item.dependencySkillId,
        versionConstraint: item.versionConstraint,
        required: item.required,
        reason: item.reason,
      })),
    });
    if (source.toolBindings.length) await tx.skillToolBinding.createMany({
      data: source.toolBindings.map((item) => ({
        skillVersionId: versionId,
        toolName: item.toolName,
        versionConstraint: item.versionConstraint,
        capabilities: item.capabilities,
        required: item.required,
        configSchema: item.configSchema === null ? undefined : item.configSchema as Prisma.InputJsonValue,
      })),
    });
    if (source.mcpBindings.length) await tx.skillMcpBinding.createMany({
      data: source.mcpBindings.map((item) => ({
        skillVersionId: versionId,
        mcpServerId: item.mcpServerId,
        serverName: item.serverName,
        toolName: item.toolName,
        capability: item.capability,
        required: item.required,
      })),
    });
  }

  private normalizeResourcePath(value: string): string {
    const path = String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!path || path.startsWith('/') || path.includes('../') || path.includes('/..')) {
      throw new BadRequestException('SKILL_RESOURCE_PATH_INVALID');
    }
    return path;
  }

  private fileType(path: string): SkillFileType {
    if (path.startsWith('scripts/')) return SkillFileType.SCRIPT;
    if (path.startsWith('references/')) return SkillFileType.REFERENCE;
    if (path.startsWith('assets/')) return SkillFileType.ASSET;
    if (/(^|\/)license(?:\.|$)/i.test(path)) return SkillFileType.LICENSE;
    return SkillFileType.OTHER;
  }

  private assertNotDeleted(deletedAt: Date | null | undefined) {
    if (deletedAt) throw new ConflictException('SKILL_DELETED');
  }
}
