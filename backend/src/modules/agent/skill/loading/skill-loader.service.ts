import { Injectable, NotFoundException } from '@nestjs/common';
import { SkillSecurityState, SkillStatus } from '@prisma/client';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillFrontmatterParser } from '../validation/skill-frontmatter.parser';
import { SkillDependencyResolverService } from '../runtime/skill-dependency-resolver.service';
import type { ActivatedSkillDocument, JsonObject, LoadedSkill, SkillActivationMode, SkillCatalogSource } from '../domain/skill.types';

@Injectable()
export class SkillLoaderService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly parser: SkillFrontmatterParser,
    private readonly dependencies: SkillDependencyResolverService,
  ) {}

  async load(input: { skillId: string; versionId: string; activationMode: SkillActivationMode; source: SkillCatalogSource; userId?: string; agentId?: string; allowNonActive?: boolean }): Promise<LoadedSkill> {
    const skill = await this.repository.client().skill.findFirst({
      where: { id: input.skillId, deletedAt: null, ...(input.allowNonActive ? {} : { status: SkillStatus.ACTIVE, securityState: SkillSecurityState.CLEAR }) },
      include: { versions: { where: { id: input.versionId }, include: { files: { orderBy: { path: 'asc' } }, schemas: true } } },
    });
    const version = skill?.versions[0];
    if (!skill || !version) throw new NotFoundException('SKILL_RUNTIME_VERSION_UNAVAILABLE');
    const parsed = this.parser.parse(version.skillMarkdown);
    const dependencies = await this.dependencies.resolve(version.id, { userId: input.userId });
    if (!dependencies.satisfied) throw new NotFoundException('SKILL_RUNTIME_DEPENDENCY_UNAVAILABLE');
    const files = version.files.map((file) => ({ id: file.id, path: file.path, type: file.fileType, mimeType: file.mimeType, sizeBytes: Number(file.sizeBytes), checksum: file.checksum, executable: file.executable, contentAvailable: Boolean(file.textContent || file.storageKey) }));
    const schema = (kind: 'INPUT' | 'OUTPUT' | 'CONFIG') => {
      const value = version.schemas.find((item) => item.kind === kind)?.schema;
      return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
    };
    const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
    return {
      skillId: skill.id,
      versionId: version.id,
      version: version.versionLabel,
      name: parsed.manifest.name,
      displayName: skill.displayName,
      slug: parsed.manifest.name,
      description: parsed.manifest.description,
      skillMarkdown: version.skillMarkdown,
      instructions: parsed.bodyRaw,
      manifest: parsed.manifest,
      files,
      references: files.filter((file) => file.type === 'REFERENCE'),
      scripts: files.filter((file) => file.type === 'SCRIPT'),
      assets: files.filter((file) => file.type === 'ASSET'),
      inputSchema: schema('INPUT'),
      outputSchema: schema('OUTPUT'),
      configSchema: schema('CONFIG'),
      validationPolicy: object(version.validationPolicy),
      failurePolicy: object(version.failurePolicy),
      permissions: object(version.executionPolicy),
      dependencies,
      checksum: version.packageChecksum,
      activationMode: input.activationMode,
      source: input.source,
    };
  }

  expose(loaded: LoadedSkill): ActivatedSkillDocument {
    return {
      name: loaded.name,
      displayName: loaded.displayName,
      description: loaded.description,
      skillMarkdown: loaded.skillMarkdown,
      resources: loaded.files,
    };
  }
}
