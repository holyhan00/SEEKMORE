import { DEFAULT_LOCALE_CONTEXT } from '../../localization/locale.types';
                                                                 
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  AgentAccessLevel,
  SeekmoreEntityType,
  KnowledgeParseStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { appError } from '../../../common/errors/app-error';
import {
  CreateCognitiveAgentDto,
  TestCognitiveAgentDto,
  UpdateCognitiveAgentDto,
  UploadCognitiveAgentKnowledgeDto,
} from './cognitive-agent.dto';
import { CognitiveAgentPolicy } from './cognitive-agent.policy';
import { SeekmoreAgentService } from '../../seekmore-agent/seekmore-agent.service';
import { KnowledgeIngestionService } from '../knowledge/knowledge-ingestion.service';
import type { KnowledgeAssetRole, KnowledgeFileUploadSpec } from '../knowledge/knowledge.types';
import { recyclePurgeAfter } from '../../../common/lifecycle/recycle-retention';
import { resolveBuiltinAssetUrl } from '../../../common/assets/builtin-asset';

type CognitiveAgentProfileObjects = {
  avatarFile?: Express.Multer.File | null;
  coverFile?: Express.Multer.File | null;
};

@Injectable()
export class CognitiveAgentService {
  private readonly logger = new Logger(CognitiveAgentService.name);

  private readonly storageRoot = path.resolve(
    process.env.AGENT_STORAGE_DIR || path.join(process.cwd(), 'storage', 'agents'),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: CognitiveAgentPolicy,
    private readonly runtime: SeekmoreAgentService,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
  ) {}

  getCapabilityOptions() {
    return {
      core: [
        {
          key: 'chat',
          labelKey: 'agents.capability.chat.name',
          descriptionKey: 'agents.capability.chat.description',
          defaultEnabled: true,
          locked: true,
        },
        {
          key: 'file_reading',
          labelKey: 'agents.capability.file_reading.name',
          descriptionKey: 'agents.capability.file_reading.description',
          defaultEnabled: true,
          locked: false,
        },
        {
          key: 'file_render',
          labelKey: 'agents.capability.file_render.name',
          descriptionKey: 'agents.capability.file_render.description',
          defaultEnabled: true,
          locked: false,
        },
        {
          key: 'docx_generation',
          labelKey: 'agents.capability.docx_generation.name',
          descriptionKey: 'agents.capability.docx_generation.description',
          defaultEnabled: true,
          locked: false,
        },
        {
          key: 'xlsx_generation',
          labelKey: 'agents.capability.xlsx_generation.name',
          descriptionKey: 'agents.capability.xlsx_generation.description',
          defaultEnabled: true,
          locked: false,
        },
      ],
      external: [
        {
          key: 'web_search',
          labelKey: 'agents.capability.web_search.name',
          descriptionKey: 'agents.capability.web_search.description',
          defaultEnabled: false,
          locked: false,
          scope: 'external_search',
          tool: 'web.search',
        },
        {
          key: 'image_generation',
          labelKey: 'agents.capability.image_generation.name',
          descriptionKey: 'agents.capability.image_generation.description',
          defaultEnabled: false,
          locked: false,
          scope: 'external_generation',
          tool: 'image.generate',
        },
      ],
      defaults: this.policy.getDefaultCognitiveCapabilities(),
    };
  }

  async create(
    userId: string,
    dto: CreateCognitiveAgentDto,
    objects: CognitiveAgentProfileObjects = {},
  ) {
    this.policy.validateProfileImages(objects.avatarFile, objects.coverFile);

    const capabilities = this.policy.normalizeCapabilities(dto.capabilities);
    const knowledgeEnabled = true;
    const memoryEnabled = true;
    const toolEnabled = true;

    const baseCapabilityProfile = this.policy.buildCapabilityProfile(capabilities);
    const capabilityProfile = {
      ...baseCapabilityProfile,
      canUseMemory: memoryEnabled,
      canUseKnowledge: knowledgeEnabled,
      tools: toolEnabled ? baseCapabilityProfile.tools : [],
    };

    let createdAgentId: string | null = null;

    try {
      const agent = await this.prisma.$transaction(async (tx) => {
        const created = await tx.agent.create({
          data: {
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            entityType: SeekmoreEntityType.COGNITIVE,
            visibility: 'PRIVATE',
            approved: true,
            isActive: true,
            userId,
            systemPrompt: '',
            rolePrompt: dto.rolePrompt.trim(),
            capabilities,
            capabilityProfile: capabilityProfile as unknown as Prisma.InputJsonValue,
            capabilityJson: this.buildCapabilityJson(capabilities, capabilityProfile),
            knowledgeEnabled,
            memoryEnabled,
            toolEnabled,
            runtimeProfileId: dto.runtimeProfileId || null,
            riskLevel: 'medium',
          },
        });

        await tx.userAgent.create({
          data: {
            userId,
            agentId: created.id,
            accessLevel: AgentAccessLevel.OWNER,
          },
        });


        return created;
      });

      createdAgentId = agent.id;
      const profileImages = await this.persistProfileImages(
        userId,
        agent.id,
        objects.avatarFile,
        objects.coverFile,
      );

      if (profileImages.avatarKey || profileImages.coverKey) {
        await this.prisma.agent.update({
          where: { id: agent.id },
          data: {
            avatarKey: profileImages.avatarKey ?? undefined,
            avatarUpdatedAt: profileImages.avatarKey ? new Date() : undefined,
            coverKey: profileImages.coverKey ?? undefined,
            coverUpdatedAt: profileImages.coverKey ? new Date() : undefined,
          },
        });
      }

      return this.findOne(userId, agent.id, { includeKnowledgeObjects: true });
    } catch (error) {
      if (createdAgentId) {
        const deletedAt = new Date();

        await this.prisma.agent
          .update({
            where: { id: createdAgentId },
            data: {
              deletedAt,
              purgeAfter: recyclePurgeAfter(deletedAt),
              isActive: false,
            },
          })
          .catch(() => undefined);
      }

      throw error;
    }
  }

  async findMy(userId: string) {
    const rows =
      await this.prisma.userAgent.findMany({
        where: {
          userId,
          deletedAt: null,
          agent: {
            entityType:
              SeekmoreEntityType.COGNITIVE,
            deletedAt: null,
            isActive: true,
            approved: true,
          },
        },
        orderBy: [
          { isDefaultAgent: 'desc' },
          { pinnedAt: 'desc' },
          { updatedAt: 'desc' },
        ],
        select: {
          accessLevel: true,
          remark: true,
          pinnedAt: true,
          isDefaultAgent: true,
          agent: {
            include: {
              knowledgeObjects: {
                where: {
                  deletedAt: null,
                },
                select: {
                  id: true,
                  originalName: true,
                  mimeType: true,
                  sizeBytes: true,
                  parseStatus: true,
                  chunkCount: true,
                  embeddingModel: true,
                  createdAt: true,
                  meta: true,
                },
              },
            },
          },
        },
      });

    return rows.map((row: any) =>
      this.withAssetUrls({
        ...row.agent,
        accessLevel:
          row.accessLevel,
        remark:
          row.remark,
        pinnedAt:
          row.pinnedAt,
        isDefaultAgent:
          row.isDefaultAgent,
        knowledgeFileCount:
          row.agent.knowledgeObjects.length,
      }),
    );
  }

  async findDeleted(userId: string) {
    const rows = await this.prisma.agent.findMany({
      where: {
        userId,
        entityType: SeekmoreEntityType.COGNITIVE,
        deletedAt: { not: null },
      },
      orderBy: [{ deletedAt: 'desc' }, { updatedAt: 'desc' }],
      include: {
        knowledgeObjects: {
          where: { deletedAt: null },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            parseStatus: true,
            chunkCount: true,
            embeddingModel: true,
            createdAt: true,
            meta: true,
          },
        },
        conversations: {
          select: {
            id: true,
            _count: {
              select: { messages: true },
            },
          },
        },
      } as any,
    });

    return rows.map((agent: any) =>
      this.withAssetUrls({
        ...agent,
        conversationCount: agent.conversations.length,
        messageCount: agent.conversations.reduce(
          (
            total: number,
            conversation: {
              _count: { messages: number };
            },
          ) => total + conversation._count.messages,
          0,
        ),
        knowledgeFileCount: agent.knowledgeObjects.length,
      }),
    );
  }

  async findOne(
    userId: string,
    agentId: string,
    options?: { includeKnowledgeObjects?: boolean },
  ) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        entityType: SeekmoreEntityType.COGNITIVE,
        deletedAt: null,
      },
      include: {
        knowledgeObjects: options?.includeKnowledgeObjects
          ? {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
            }
          : false,
        userAgents: {
          where: { userId, deletedAt: null },
          select: {
            accessLevel: true,
            remark: true,
            pinnedAt: true,
            isDefaultAgent: true,
          },
        },
      } as any,
    });

    if (!agent) throw new NotFoundException(appError('COGNITIVE_AGENT_NOT_FOUND'));

    if ((agent as any).userId !== userId && (agent as any).userAgents.length === 0) {
      throw new ForbiddenException(appError('COGNITIVE_AGENT_ACCESS_DENIED'));
    }

    const relation =
      (agent as any).userAgents?.[0]
      ?? null;

    const {
      userAgents: _userAgents,
      ...agentData
    } = agent as any;

    return this.withAssetUrls({
      ...agentData,
      accessLevel:
        relation?.accessLevel
        ?? null,
      remark:
        relation?.remark
        ?? null,
      pinnedAt:
        relation?.pinnedAt
        ?? null,
      isDefaultAgent:
        relation?.isDefaultAgent
        ?? false,
    });
  }

  async update(
    userId: string,
    agentId: string,
    dto: UpdateCognitiveAgentDto,
    objects: CognitiveAgentProfileObjects = {},
  ) {
    await this.assertOwner(userId, agentId);

    this.policy.validateProfileImages(objects.avatarFile, objects.coverFile);

    const updateData: Prisma.AgentUpdateInput = {};

    if (dto.name !== undefined) updateData.name = dto.name.trim();
    if (dto.description !== undefined) updateData.description = dto.description?.trim() || null;
    if (dto.rolePrompt !== undefined) updateData.rolePrompt = dto.rolePrompt.trim();
    if (dto.capabilities !== undefined) {
      const capabilities = this.policy.normalizeCapabilities(dto.capabilities);
      const capabilityProfile = this.policy.buildCapabilityProfile(capabilities);

      updateData.capabilities = capabilities;
      updateData.capabilityProfile = capabilityProfile as unknown as Prisma.InputJsonValue;
      updateData.capabilityJson = this.buildCapabilityJson(capabilities, capabilityProfile);
    }

    const currentProfile = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        avatarKey: true,
        coverKey: true,
      },
    });

    const profileImages = await this.persistProfileImages(
      userId,
      agentId,
      objects.avatarFile,
      objects.coverFile,
    );

    if (profileImages.avatarKey) {
      updateData.avatarKey = profileImages.avatarKey;
      updateData.avatarUpdatedAt = new Date();
    }

    if (profileImages.coverKey) {
      updateData.coverKey = profileImages.coverKey;
      updateData.coverUpdatedAt = new Date();
    }

    try {
      await this.prisma.agent.update({
        where: { id: agentId },
        data: updateData,
      });
    } catch (error) {
      await Promise.all([
        this.removeProfileImageKey(profileImages.avatarKey),
        this.removeProfileImageKey(profileImages.coverKey),
      ]);
      throw error;
    }

    await Promise.all([
      profileImages.avatarKey
        ? this.removeProfileImageKey(currentProfile?.avatarKey)
        : Promise.resolve(),
      profileImages.coverKey
        ? this.removeProfileImageKey(currentProfile?.coverKey)
        : Promise.resolve(),
    ]);

    return this.findOne(userId, agentId, { includeKnowledgeObjects: true });
  }

  async test(userId: string, agentId: string, dto: TestCognitiveAgentDto) {
    await this.findOne(userId, agentId, {
      includeKnowledgeObjects: false,
    });

    const traceId = `cognitive-test-${agentId}-${Date.now()}`;
    const localization = DEFAULT_LOCALE_CONTEXT;
    const result = await this.runtime.runChatTurn({
      traceId,
      userId,
      agentId,
      conversationId: `cognitive-test:${agentId}:${userId}`,
      parentMessageId: null,
      userMessageId: `cognitive-user:${traceId}`,
      contextLeafMessageId: `cognitive-user:${traceId}`,
      assistantMessageId: `cognitive-assistant:${traceId}`,
      input: dto.input.trim(),
      model: null,
      stream: false,
      localization,
    });

    return {
      agentId,
      input: dto.input,
      output: result?.content ?? result,
      traceId: result?.traceId,
      warnings: result?.warnings ?? [],
    };
  }

  async validateForPublish(userId: string, agentId: string) {
    const agent: any = await this.findOne(userId, agentId, {
      includeKnowledgeObjects: true,
    });

    const issues: Array<{
      level: 'error' | 'warning';
      code: string;
      params?: Record<string, string | number | boolean | null>;
    }> = [];

    if (!agent.name || agent.name.trim().length < 2) {
      issues.push({ level: 'error', code: 'NAME_TOO_SHORT' });
    }

    if (!agent.description || agent.description.trim().length < 10) {
      issues.push({
        level: 'warning',
        code: 'DESCRIPTION_WEAK',
      });
    }

    const effectiveRolePrompt = String(
      agent.rolePrompt || agent.systemPrompt || '',
    ).trim();

    if (effectiveRolePrompt.length < 20) {
      issues.push({
        level: 'error',
        code: 'ROLE_PROMPT_WEAK',
      });
    }

    if (!agent.capabilities.length) {
      issues.push({
        level: 'error',
        code: 'NO_CAPABILITIES',
      });
    }

    if (agent.knowledgeEnabled) {
      const failedObjects = await this.prisma.agentKnowledgeObject.count({
        where: {
          agentId,
          deletedAt: null,
          parseStatus: KnowledgeParseStatus.FAILED,
        },
      });

      if (failedObjects > 0) {
        issues.push({
          level: 'warning',
          code: 'KNOWLEDGE_PARSE_FAILED',
          params: { count: failedObjects },
        });
      }

      const pendingObjects = await this.prisma.agentKnowledgeObject.count({
        where: {
          agentId,
          deletedAt: null,
          parseStatus: KnowledgeParseStatus.PENDING,
        },
      });

      if (pendingObjects > 0) {
        issues.push({
          level: 'warning',
          code: 'KNOWLEDGE_PARSE_PENDING',
          params: { count: pendingObjects },
        });
      }
    }

    const errorCount = issues.filter((item) => item.level === 'error').length;

    return {
      agentId,
      passed: errorCount === 0,
      errorCount,
      warningCount: issues.length - errorCount,
      issues,
    };
  }

  async uploadKnowledge(
    userId: string,
    agentId: string,
    dto: UploadCognitiveAgentKnowledgeDto,
    objects: { knowledgeObjects: Express.Multer.File[] },
  ) {
    await this.assertOwner(userId, agentId);

    const knowledgeObjects = objects.knowledgeObjects || [];
    this.policy.validateKnowledgeObjects(knowledgeObjects);

    if (!knowledgeObjects.length) {
      throw new BadRequestException(appError('KNOWLEDGE_FILE_SELECTION_REQUIRED'));
    }

    const uploadSpecs = this.parseKnowledgeUploadSpecs(
      (dto as any)?.knowledgeFileSpecs,
      knowledgeObjects,
    );

    const savedObjects = await this.persistKnowledgeObjects(
      userId,
      agentId,
      knowledgeObjects,
      uploadSpecs,
    );

    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        userId,
        entityType: SeekmoreEntityType.COGNITIVE,
        deletedAt: null,
      },
      select: {
        id: true,
        knowledgeEnabled: true,
      },
    });

    if (!agent) {
      throw new NotFoundException(appError('COGNITIVE_AGENT_NOT_FOUND'));
    }

    if (agent.knowledgeEnabled) {
      await this.knowledgeIngestion.ingestPendingForAgent(agentId).catch(() => undefined);
    }

    return {
      ok: true,
      status: agent.knowledgeEnabled ? 'INGESTION_TRIGGERED' : 'UPLOADED',
      count: savedObjects.length,
      objects: await this.listKnowledge(userId, agentId),
    };
  }

  async listKnowledge(userId: string, agentId: string) {
    await this.findOne(userId, agentId);

    return this.prisma.agentKnowledgeObject.findMany({
      where: { agentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });
  }

  async deleteKnowledge(userId: string, agentId: string, objectId: string) {
    await this.assertOwner(userId, agentId);

    const object = await this.prisma.agentKnowledgeObject.findFirst({
      where: { id: objectId, agentId, deletedAt: null },
      select: { id: true },
    });

    if (!object) throw new NotFoundException(appError('KNOWLEDGE_FILE_NOT_FOUND'));

    await this.prisma.agentKnowledgeObject.update({
      where: { id: objectId },
      data: { deletedAt: new Date() },
    });

    return { ok: true };
  }

  async reparseKnowledge(userId: string, agentId: string) {
    await this.assertOwner(userId, agentId);

    await this.prisma.agentKnowledgeObject.updateMany({
      where: { agentId, deletedAt: null },
      data: {
        parseStatus: KnowledgeParseStatus.PENDING,
        parseError: null,
      },
    });

    await this.knowledgeIngestion.ingestPendingForAgent(agentId).catch(() => undefined);

    return { ok: true, status: 'REPARSE_TRIGGERED' };
  }

  async restore(userId: string, agentId: string) {
    const restored = await this.prisma.$transaction(async (tx) => {
      const agent = await tx.agent.findFirst({
        where: {
          id: agentId,
          userId,
          entityType: SeekmoreEntityType.COGNITIVE,
          deletedAt: { not: null },
        },
        select: {
          id: true,
          knowledgeEnabled: true,
          purgeAfter: true,
        },
      });

      if (!agent) {
        throw new NotFoundException(appError('COGNITIVE_AGENT_DELETED_NOT_FOUND'));
      }

      if (
        agent.purgeAfter &&
        agent.purgeAfter.getTime() <= Date.now()
      ) {
        throw new BadRequestException(
          appError('COGNITIVE_AGENT_RETENTION_EXPIRED'),
        );
      }

      const ownerRelation = await tx.userAgent.findFirst({
        where: {
          userId,
          agentId,
          accessLevel: AgentAccessLevel.OWNER,
        },
        select: { id: true },
      });

      if (!ownerRelation) {
        throw new BadRequestException(appError('COGNITIVE_AGENT_OWNER_RELATION_MISSING'));
      }

      await tx.agent.update({
        where: { id: agentId },
        data: {
          deletedAt: null,
          purgeAfter: null,
          isActive: true,
        },
      });

      return agent;
    });

    if (restored.knowledgeEnabled) {
      await this.knowledgeIngestion.ingestPendingForAgent(agentId).catch(() => undefined);
    }

    return this.findOne(userId, agentId, { includeKnowledgeObjects: true });
  }

  async softDelete(userId: string, agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        userId,
        entityType: SeekmoreEntityType.COGNITIVE,
      },
      select: {
        id: true,
        deletedAt: true,
        purgeAfter: true,
      },
    });

    if (!agent) {
      throw new NotFoundException(appError('COGNITIVE_AGENT_NOT_FOUND'));
    }

    if (agent.deletedAt) {
      return {
        ok: true,
        deletedAt: agent.deletedAt.toISOString(),
        purgeAfter:
          agent.purgeAfter?.toISOString() ??
          recyclePurgeAfter(agent.deletedAt).toISOString(),
      };
    }

    await this.assertOwner(userId, agentId);

    const deletedAt = new Date();
    const purgeAfter = recyclePurgeAfter(deletedAt);

    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        deletedAt,
        purgeAfter,
        isActive: false,
      },
    });

    return {
      ok: true,
      deletedAt: deletedAt.toISOString(),
      purgeAfter: purgeAfter.toISOString(),
    };
  }

  private async assertOwner(userId: string, agentId: string) {
    const relation =
      await this.prisma.userAgent.findFirst({
        where: {
          userId,
          agentId,
          deletedAt: null,
          accessLevel:
            AgentAccessLevel.OWNER,
        },
        include: {
          agent: {
            select: {
              isSuper: true,
            },
          },
        },
      });

    if (!relation) {
      throw new ForbiddenException(
        appError('COGNITIVE_AGENT_OWNER_REQUIRED'),
      );
    }

    if (relation.agent.isSuper) {
      throw new ForbiddenException(
        appError('COGNITIVE_AGENT_SYSTEM_MANAGED'),
      );
    }
  }

  private async removeProfileImageKey(
    storageKey?: string | null,
  ): Promise<void> {
    const absolutePath =
      this.resolveProfileStoragePath(storageKey);

    if (!absolutePath) {
      return;
    }

    await fs.rm(absolutePath, { force: true })
      .catch(() => undefined);
  }

  private resolveProfileStoragePath(
    storageKey?: string | null,
  ): string | null {
    const normalized = String(storageKey ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const prefix = 'storage/agents/';

    if (!normalized.startsWith(prefix)) {
      return null;
    }

    const relative = normalized.slice(prefix.length);
    const absolute = path.resolve(this.storageRoot, relative);
    const rootPrefix = `${this.storageRoot}${path.sep}`;

    if (
      absolute !== this.storageRoot
      && !absolute.startsWith(rootPrefix)
    ) {
      return null;
    }

    return absolute;
  }

  private async persistProfileImages(
    userId: string,
    agentId: string,
    avatarFile?: Express.Multer.File | null,
    coverFile?: Express.Multer.File | null,
  ): Promise<{ avatarKey: string | null; coverKey: string | null }> {
    const dir = path.join(this.storageRoot, userId, agentId, 'profile');
    await fs.mkdir(dir, { recursive: true });

    this.logger.log(
      [
        '[CognitiveAgent][ProfileImage]',
        `cwd=${process.cwd()}`,
        `storageRoot=${this.storageRoot}`,
        `dir=${dir}`,
        `userId=${userId}`,
        `agentId=${agentId}`,
        `avatar=${avatarFile?.originalname ?? '-'}`,
        `cover=${coverFile?.originalname ?? '-'}`,
      ].join(' '),
    );

    const saveImage = async (
      file: Express.Multer.File | null | undefined,
      prefix: 'avatar' | 'cover',
    ): Promise<string | null> => {
      if (!file) return null;

      if (!file.buffer || file.buffer.length === 0) {
        throw new BadRequestException(appError('AGENT_PROFILE_FILE_EMPTY', { field: prefix }));
      }

      const extension = this.safeImageExt(file.originalname, file.mimetype);
      const storedName = `${prefix}-${Date.now()}-${randomUUID()}${extension}`;
      const absolutePath = path.join(dir, storedName);

      await fs.writeFile(absolutePath, file.buffer);

      const stat = await fs.stat(absolutePath);
      if (!stat.isFile() || stat.size <= 0) {
        throw new BadRequestException(appError('AGENT_PROFILE_FILE_WRITE_FAILED', { field: prefix }));
      }

      const storageKey = path
        .join('storage', 'agents', userId, agentId, 'profile', storedName)
        .replace(/\\/g, '/');

      this.logger.log(
        [
          '[CognitiveAgent][ProfileImageSaved]',
          `prefix=${prefix}`,
          `storageKey=${storageKey}`,
          `absolutePath=${absolutePath}`,
          `size=${stat.size}`,
        ].join(' '),
      );

      return storageKey;
    };

    return {
      avatarKey: await saveImage(avatarFile, 'avatar'),
      coverKey: await saveImage(coverFile, 'cover'),
    };
  }

  private async persistKnowledgeObjects(
    userId: string,
    agentId: string,
    objects: Express.Multer.File[],
    specs: KnowledgeFileUploadSpec[] = [],
  ): Promise<Prisma.AgentKnowledgeObjectGetPayload<{}>[]> {
    if (!objects.length) {
      this.logger.log(
        [
          '[CognitiveAgent][KnowledgePersistSkip]',
          `storageRoot=${this.storageRoot}`,
          `userId=${userId}`,
          `agentId=${agentId}`,
          'fileCount=0',
        ].join(' '),
      );
      return [];
    }

    this.logger.log(
      [
        '[CognitiveAgent][KnowledgePersistStart]',
        `storageRoot=${this.storageRoot}`,
        `userId=${userId}`,
        `agentId=${agentId}`,
        `fileCount=${objects.length}`,
        `specCount=${specs.length}`,
      ].join(' '),
    );

    const dir = path.join(this.storageRoot, userId, agentId, 'knowledge');
    await fs.mkdir(dir, { recursive: true });

    const records: Prisma.AgentKnowledgeObjectGetPayload<{}>[] = [];

    for (let index = 0; index < objects.length; index += 1) {
      const file = objects[index];
      const spec = this.findUploadSpec(specs, index, file.originalname);

      const originalName = this.normalizeOriginalName(file.originalname);
      const extension = this.safeExt(originalName);
      const storedName = `${Date.now()}-${randomUUID()}${extension}`;
      const storageKey = path
        .join('storage', 'agents', userId, agentId, 'knowledge', storedName)
        .replace(/\\/g, '/');
      const absolutePath = path.join(dir, storedName);

      if (!file.buffer || file.buffer.length === 0) {
        throw new BadRequestException(appError('KNOWLEDGE_FILE_CONTENT_EMPTY', { fileName: originalName }));
      }

      await fs.writeFile(absolutePath, file.buffer);

      const stat = await fs.stat(absolutePath);
      if (!stat.isFile() || stat.size <= 0) {
        throw new BadRequestException(appError('KNOWLEDGE_FILE_WRITE_FAILED', { fileName: originalName }));
      }

      this.logger.log(
        [
          '[CognitiveAgent][KnowledgeFileSaved]',
          `index=${index}`,
          `originalName=${originalName}`,
          `storedName=${storedName}`,
          `absolutePath=${absolutePath}`,
          `storageKey=${storageKey}`,
          `size=${stat.size}`,
          `mimeType=${file.mimetype}`,
          `role=${spec.objectRole}`,
          `kind=${spec.objectKind}`,
        ].join(' '),
      );

      const sha256 = createHash('sha256').update(file.buffer).digest('hex');

      const record = await this.prisma.agentKnowledgeObject.create({
        data: {
          userId,
          agentId,
          originalName,
          storedName,
          mimeType: file.mimetype,
          extension: extension.replace('.', '') || null,
          sizeBytes: file.size,
          sha256,
          storageKey,
          parseStatus: KnowledgeParseStatus.PENDING,
          meta: {
            encoding: file.encoding,
            fieldname: file.fieldname,
            objectRole: spec.objectRole,
            objectKind: spec.objectKind,
            displayName: spec.name,
            description: spec.description,
            isDefault: spec.isDefault ?? false,
            sortOrder: spec.sortOrder ?? index,
            tags: spec.tags ?? [],
            templateContract: this.asJsonObject(spec.meta?.templateContract),
            templatePreview: this.asJsonObject(spec.meta?.templatePreview),
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        [
          '[CognitiveAgent][KnowledgeDbCreated]',
          `objectId=${record.id}`,
          `agentId=${agentId}`,
          `userId=${userId}`,
          `originalName=${record.originalName}`,
          `storageKey=${record.storageKey}`,
          `parseStatus=${record.parseStatus}`,
          `chunkCount=${record.chunkCount ?? 0}`,
        ].join(' '),
      );

      records.push(record);
    }

    this.logger.log(
      [
        '[CognitiveAgent][KnowledgePersistDone]',
        `userId=${userId}`,
        `agentId=${agentId}`,
        `count=${records.length}`,
      ].join(' '),
    );

    return records;
  }

 

  private parseKnowledgeUploadSpecs(
  raw: unknown,
  objects: Express.Multer.File[],
): KnowledgeFileUploadSpec[] {
  const parsed = this.parseJsonArray(raw);

  const specs: KnowledgeFileUploadSpec[] = objects.map(
    (file, index): KnowledgeFileUploadSpec => {
      const item = parsed.find((x: any) => {
        const fileIndex = Number(x?.fileIndex);
        const byIndex = Number.isInteger(fileIndex) && fileIndex === index;

        const incomingName =
          typeof x?.originalName === 'string'
            ? x.originalName
            : typeof x?.objectName === 'string'
              ? x.objectName
              : typeof x?.name === 'string'
                ? x.name
                : '';

        const byName =
          Boolean(incomingName) &&
          this.normalizeOriginalName(incomingName) ===
            this.normalizeOriginalName(file.originalname);

        return byIndex || byName;
      });

      const originalName = this.normalizeOriginalName(file.originalname);
      const objectRole = this.normalizeAssetRole(item?.objectRole);
      const objectKind = this.normalizeObjectKind(
        item?.objectKind ||
          this.inferObjectKind(
            path.extname(originalName).replace('.', ''),
            file.mimetype,
          ),
      );

      return {
        fileIndex: index,
        originalName,
        name:
          this.optionalLimitedString(item?.name, 180) ||
          this.stripExtension(originalName),
        description: this.optionalLimitedString(item?.description, 500),
        objectRole,
        objectKind,
        isDefault: this.normalizeBoolean(
          item?.isDefault ?? item?.isDefaultTemplate,
          false,
        ),
        sortOrder: this.normalizeInteger(item?.sortOrder, index),
        tags: this.normalizeStringArray(item?.tags, 20, 40),
        meta: this.asJsonObject(item?.meta) ?? undefined,
      };
    },
  );

  return specs;
}


  private asJsonObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private parseJsonArray(raw: unknown): any[] {
    if (Array.isArray(raw)) return raw;

    if (typeof raw !== 'string' || !raw.trim()) return [];

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private normalizeAssetRole(value: unknown): KnowledgeAssetRole {
    const raw = String(value || '').trim();

    if (raw === 'content_material') return 'content_material';

    return 'content_material';
  }

  private normalizeObjectKind(value: unknown): any {
    const raw = String(value || '').trim().toLowerCase();
    const allowed = new Set(['docx', 'xlsx', 'pptx', 'pdf', 'zip']);

    return allowed.has(raw) ? raw : 'docx';
  }

  private inferObjectKind(extension?: string | null, mimeType?: string | null): any {
    const ext = String(extension || '').replace(/^\./, '').toLowerCase();
    const mime = String(mimeType || '').toLowerCase();

    if (ext === 'xlsx' || mime.includes('spreadsheet')) return 'xlsx';
    if (ext === 'pptx' || mime.includes('presentation')) return 'pptx';
    if (ext === 'pdf' || mime.includes('pdf')) return 'pdf';
    if (ext === 'zip' || mime.includes('zip')) return 'zip';

    return 'docx';
  }

  private findUploadSpec(
    specs: KnowledgeFileUploadSpec[],
    index: number,
    originalName: string,
  ): KnowledgeFileUploadSpec {
    const normalized = this.normalizeOriginalName(originalName);

    return (
      specs.find((item) => item.fileIndex === index) ||
      specs.find((item) => item.originalName === normalized) || {
        fileIndex: index,
        originalName: normalized,
        name: this.stripExtension(normalized),
        objectRole: 'content_material',
        objectKind: this.inferObjectKind(path.extname(normalized).replace('.', ''), null),
        isDefault: false,
        sortOrder: index,
        tags: [],
      }
    );
  }

  private normalizeOriginalName(name: string): string {
    if (!name) return 'file';

    try {
      const decoded = Buffer.from(name, 'latin1').toString('utf8');
      return decoded.includes('�') ? name : decoded;
    } catch {
      return name;
    }
  }

  private safeImageExt(objectName: string, mimeType?: string): string {
    const ext = path.extname(objectName || '').toLowerCase();
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp']);

    if (allowed.has(ext)) return ext;
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/webp') return '.webp';

    return '.png';
  }

  private safeExt(objectName: string): string {
    const ext = path.extname(objectName || '').toLowerCase();

    const allowed = new Set([
      '.txt',
      '.md',
      '.json',
      '.pdf',
      '.doc',
      '.docx',
      '.xlsx',
      '.csv',
      '.html',
      '.htm',
      '.pptx',
      '.zip',
    ]);

    return allowed.has(ext) ? ext : '';
  }

  private stripExtension(objectName: string): string {
    const base = path.basename(objectName || 'file', path.extname(objectName || ''));
    return base.trim() || 'file';
  }

  private assetUrl(
    agentId: string,
    key: string | null | undefined,
    kind: 'avatar' | 'cover',
  ): string | null {
    if (!key) return null;

    const builtinUrl =
      resolveBuiltinAssetUrl(key);

    if (builtinUrl) {
      return builtinUrl;
    }

    return `/api/agent/${encodeURIComponent(agentId)}/profile/${kind}`;
  }

  private withAssetUrls<T extends { id: string; avatarKey?: string | null; coverKey?: string | null }>(
    agent: T,
  ) {
    return {
      ...agent,
      avatarUrl: this.assetUrl(agent.id, agent.avatarKey, 'avatar'),
      coverUrl: this.assetUrl(agent.id, agent.coverKey, 'cover'),
    };
  }


  private normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
      if (normalized === '1') return true;
      if (normalized === '0') return false;
    }

    return defaultValue;
  }

  private normalizeInteger(value: unknown, defaultValue: number): number {
    const n = Number(value);
    if (!Number.isInteger(n)) return defaultValue;
    return n;
  }

  private optionalLimitedString(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    if (!text) return undefined;
    return text.slice(0, max);
  }

  private normalizeStringArray(value: unknown, maxItems: number, maxLen: number): string[] {
    const raw = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [];

    return Array.from(
      new Set(
        raw
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .map((item) => item.slice(0, maxLen)),
      ),
    ).slice(0, maxItems);
  }

  private buildCapabilityJson(capabilities: unknown, profile: unknown) {
    return {
      kind: 'cognitive',
      capabilities,
      profile,
      governance: {
        humanReviewRequired: false,
        publishRequiresValidation: true,
      },
    } as Prisma.InputJsonValue;
  }

}
