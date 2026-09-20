import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  SkillActivationMode,
  SkillSecurityState,
  SkillStatus,
  SkillVersionPolicy,
  SkillVersionStatus,
} from '@prisma/client';
import type { ReplaceAgentSkillBindingsDto } from '../api/dto/skill.dto';
import {
  isLegacyDisabledActivationMode,
  normalizeAgentDefaultActivationMode,
  resolveAgentSkillActivationMode,
  toAgentSkillActivationMode,
  toPersistenceActivationMode,
} from '../domain/agent-skill-activation';
import {
  AGENT_SKILL_ORDER_MAX,
  normalizeRequestedAgentSkillOrder,
  normalizeStoredAgentSkillOrder,
} from '../domain/agent-skill-order';
import { defaultSkillRuntimePolicy } from '../domain/skill-policy';
import { toSkillApiJson } from '../domain/skill-json.util';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillAuditService } from '../usage/skill-audit.service';
import { SkillAccessService } from './skill-access.service';

@Injectable()
export class SkillBindingService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly access: SkillAccessService,
    private readonly audit: SkillAuditService,
  ) {}

  async get(userId: string, agentId: string) {
    await this.access.cognitiveReadable(userId, agentId);

    const [policy, bindings] = await Promise.all([
      this.repository
        .client()
        .cognitiveAgentSkillPolicy.findUnique({ where: { agentId } }),
      this.repository.client().cognitiveAgentSkillBinding.findMany({
        where: { cognitiveAgentId: agentId },
        include: {
          skill: { include: { currentVersion: true, source: true } },
          pinnedVersion: true,
        },
      }),
    ]);

    const defaultMode = normalizeAgentDefaultActivationMode(
      policy?.defaultActivationMode,
    );

    const projectedBindings = normalizeStoredAgentSkillOrder(
      bindings.map((binding) => {
        const activationMode = toAgentSkillActivationMode(
          binding.activationMode,
        );
        const enabled =
          binding.enabled &&
          !isLegacyDisabledActivationMode(binding.activationMode);

        return {
          ...binding,
          enabled,
          activationMode,
          effectiveActivationMode: resolveAgentSkillActivationMode(
            activationMode,
            defaultMode,
          ),
        };
      }),
    );

    const projectedPolicy = policy
      ? {
          id: policy.id,
          agentId: policy.agentId,
          defaultActivationMode: defaultMode,
          maxCatalogEntries: policy.maxCatalogEntries,
          catalogCharBudget: policy.catalogCharBudget,
          instructionTokenBudget: policy.instructionTokenBudget,
          resourceTokenBudget: policy.resourceTokenBudget,
          maxAutomaticSkills: policy.maxAutomaticSkills,
          maxResourceFiles: policy.maxResourceFiles,
          revision: policy.revision,
          createdAt: policy.createdAt,
          updatedAt: policy.updatedAt,
        }
      : null;

    return toSkillApiJson({
      policy: projectedPolicy,
      bindings: projectedBindings,
    });
  }

  async replace(
    userId: string,
    agentId: string,
    dto: ReplaceAgentSkillBindingsDto,
  ) {
    await this.repository.transaction(async (tx) => {
      await this.access.cognitiveOwner(userId, agentId, tx);

      const [currentPolicy, currentBindings] = await Promise.all([
        tx.cognitiveAgentSkillPolicy.findUnique({ where: { agentId } }),
        tx.cognitiveAgentSkillBinding.findMany({
          where: { cognitiveAgentId: agentId },
        }),
      ]);

      const currentRevision = currentPolicy?.revision ?? 0;
      if (currentRevision !== dto.expectedRevision) {
        throw new ConflictException('AGENT_SKILL_POLICY_REVISION_CONFLICT');
      }

      if (dto.bindings.length > AGENT_SKILL_ORDER_MAX) {
        throw new BadRequestException('AGENT_SKILL_BINDING_LIMIT_EXCEEDED');
      }

      const normalizedBindings = normalizeRequestedAgentSkillOrder(
        dto.bindings,
      );
      const unique = new Map(
        normalizedBindings.map((binding) => [binding.skillId, binding]),
      );
      if (unique.size !== normalizedBindings.length) {
        throw new BadRequestException('DUPLICATE_AGENT_SKILL_BINDING');
      }

      const skills = unique.size
        ? await Promise.all(
            [...unique.keys()].map((skillId) =>
              this.repository.findUserLibrarySkillIncludingDeleted(userId, skillId, tx),
            ),
          )
        : [];
      const librarySkills = skills.filter(
        (skill): skill is NonNullable<typeof skill> => Boolean(skill),
      );

      if (librarySkills.length !== unique.size) {
        throw new BadRequestException('AGENT_SKILL_NOT_IN_USER_LIBRARY');
      }

      const currentBindingBySkillId = new Map(
        currentBindings.map((binding) => [binding.skillId, binding]),
      );
      const deletedSkillIds = new Set<string>();

      for (const skill of librarySkills) {
        const binding = unique.get(skill.id)!;

        if (skill.deletedAt) {
          const currentBinding = currentBindingBySkillId.get(skill.id);

          if (!currentBinding) {
            throw new BadRequestException({
              code: 'SKILL_DELETED_CANNOT_BIND',
              message: 'SKILL_DELETED_CANNOT_BIND',
              skillId: skill.id,
            });
          }

          if (binding.enabled !== currentBinding.enabled) {
            throw new BadRequestException({
              code: 'SKILL_DELETED_RESTORE_REQUIRED',
              message: 'SKILL_DELETED_RESTORE_REQUIRED',
              skillId: skill.id,
            });
          }

          deletedSkillIds.add(skill.id);
          continue;
        }

        if (
          skill.status === SkillStatus.ARCHIVED ||
          skill.securityState === SkillSecurityState.BLOCKED
        ) {
          throw new BadRequestException({ code: 'SKILL_NOT_BINDABLE', message: 'SKILL_NOT_BINDABLE', params: { skillId: skill.id } });
        }

        if (
          binding.enabled &&
          (skill.status !== SkillStatus.ACTIVE ||
            skill.securityState !== SkillSecurityState.CLEAR)
        ) {
          throw new BadRequestException({
            code: 'ENABLED_SKILL_MUST_BE_ACTIVE_AND_CLEAR',
            message: 'ENABLED_SKILL_MUST_BE_ACTIVE_AND_CLEAR',
            params: { skillId: skill.id },
          });
        }

        if (binding.versionPolicy === SkillVersionPolicy.PINNED) {
          if (!binding.pinnedVersionId) {
            throw new BadRequestException({
              code: 'PINNED_VERSION_REQUIRED',
              message: 'PINNED_VERSION_REQUIRED',
              params: { skillId: skill.id },
            });
          }

          const version = await tx.skillVersion.findFirst({
            where: {
              id: binding.pinnedVersionId,
              skillId: skill.id,
              status: {
                in: [
                  SkillVersionStatus.PUBLISHED,
                  SkillVersionStatus.SUPERSEDED,
                ],
              },
            },
          });

          if (!version) {
            throw new BadRequestException({ code: 'PINNED_VERSION_INVALID', message: 'PINNED_VERSION_INVALID', params: { skillId: skill.id } });
          }
        }
      }

      const requestedIds = [...unique.keys()];
      await tx.cognitiveAgentSkillBinding.deleteMany({
        where: {
          cognitiveAgentId: agentId,
          skillId: {
            notIn: requestedIds.length ? requestedIds : ['__none__'],
          },
        },
      });

      for (const binding of normalizedBindings) {
        if (deletedSkillIds.has(binding.skillId)) {
          continue;
        }

        const activationMode = toPersistenceActivationMode(
          binding.activationMode,
        ) as SkillActivationMode | null;

        await tx.cognitiveAgentSkillBinding.upsert({
          where: {
            cognitiveAgentId_skillId: {
              cognitiveAgentId: agentId,
              skillId: binding.skillId,
            },
          },
          create: {
            cognitiveAgentId: agentId,
            skillId: binding.skillId,
            activationMode,
            priority: binding.priority,
            enabled: binding.enabled,
            versionPolicy: binding.versionPolicy,
            versionConstraint: binding.versionConstraint ?? null,
            pinnedVersionId: binding.pinnedVersionId ?? null,
            config: (binding.config ?? {}) as Prisma.InputJsonValue,
            permissionOverrides: (binding.permissionOverrides ??
              {}) as Prisma.InputJsonValue,
          },
          update: {
            activationMode,
            priority: binding.priority,
            enabled: binding.enabled,
            versionPolicy: binding.versionPolicy,
            versionConstraint: binding.versionConstraint ?? null,
            pinnedVersionId: binding.pinnedVersionId ?? null,
            config: (binding.config ?? {}) as Prisma.InputJsonValue,
            permissionOverrides: (binding.permissionOverrides ??
              {}) as Prisma.InputJsonValue,
          },
        });
      }

      const defaults = defaultSkillRuntimePolicy();
      const defaultActivationMode = normalizeAgentDefaultActivationMode(
        dto.defaultActivationMode,
      ) as SkillActivationMode;

      await tx.cognitiveAgentSkillPolicy.upsert({
        where: { agentId },
        create: {
          agentId,
          defaultActivationMode,
          maxCatalogEntries:
            dto.maxCatalogEntries ?? defaults.maxCatalogEntries,
          catalogCharBudget:
            dto.catalogCharBudget ?? defaults.catalogCharBudget,
          instructionTokenBudget:
            dto.instructionTokenBudget ?? defaults.instructionTokenBudget,
          resourceTokenBudget:
            dto.resourceTokenBudget ?? defaults.resourceTokenBudget,
          maxAutomaticSkills:
            dto.maxAutomaticSkills ?? defaults.maxAutomaticSkills,
          maxResourceFiles: dto.maxResourceFiles ?? defaults.maxResourceFiles,
          publicDiscoveryEnabled: false,
          publicCatalogLimit: 0,
          revision: 1,
        },
        update: {
          defaultActivationMode,
          ...(dto.maxCatalogEntries !== undefined
            ? { maxCatalogEntries: dto.maxCatalogEntries }
            : {}),
          ...(dto.catalogCharBudget !== undefined
            ? { catalogCharBudget: dto.catalogCharBudget }
            : {}),
          ...(dto.instructionTokenBudget !== undefined
            ? { instructionTokenBudget: dto.instructionTokenBudget }
            : {}),
          ...(dto.resourceTokenBudget !== undefined
            ? { resourceTokenBudget: dto.resourceTokenBudget }
            : {}),
          ...(dto.maxAutomaticSkills !== undefined
            ? { maxAutomaticSkills: dto.maxAutomaticSkills }
            : {}),
          ...(dto.maxResourceFiles !== undefined
            ? { maxResourceFiles: dto.maxResourceFiles }
            : {}),
          publicDiscoveryEnabled: false,
          publicCatalogLimit: 0,
          revision: { increment: 1 },
        },
      });

      const beforeBySkill = new Map(
        currentBindings.map((item) => [item.skillId, item]),
      );
      const afterBySkill = new Map(
        normalizedBindings.map((item) => [item.skillId, item]),
      );

      for (const skillId of new Set([
        ...beforeBySkill.keys(),
        ...afterBySkill.keys(),
      ])) {
        await this.audit.write(
          {
            skillId,
            actorUserId: userId,
            eventType: afterBySkill.has(skillId)
              ? beforeBySkill.has(skillId)
                ? 'AGENT_BINDING_UPDATED'
                : 'AGENT_BINDING_CREATED'
              : 'AGENT_BINDING_REMOVED',
            beforeData: beforeBySkill.get(skillId) ?? null,
            afterData: afterBySkill.get(skillId) ?? null,
            metadata: { agentId },
          },
          tx,
        );
      }
    });

    return this.get(userId, agentId);
  }
}
