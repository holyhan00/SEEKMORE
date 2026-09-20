import { Injectable } from '@nestjs/common';
import {
  SkillActivationMode,
  SkillActivationSource,
  SkillInstallationStatus,
  SkillPrincipalType,
  SkillSecurityState,
  SkillSourceKind,
  SkillStatus,
  SkillUsageOutcome,
} from '@prisma/client';
import { SkillRepository } from '../persistence/skill.repository';
import { SkillVersionResolverService } from '../resolution/skill-version-resolver.service';
import { SkillCatalogBuilder } from '../catalog/skill-catalog.builder';
import { SkillLoaderService } from '../loading/skill-loader.service';
import { defaultSkillRuntimePolicy } from '../domain/skill-policy';
import {
  isLegacyDisabledActivationMode,
  normalizeAgentDefaultActivationMode,
  resolveAgentSkillActivationMode,
  toAgentSkillActivationMode,
} from '../domain/agent-skill-activation';
import { normalizeStoredAgentSkillOrder } from '../domain/agent-skill-order';
import { estimateTokens } from '../domain/skill-content.util';
import type {
  ActivatedSkillDocument,
  SkillCatalogEntry,
  SkillRuntimePolicy,
  SkillTurnPreparedContext,
} from '../domain/skill.types';
import { SkillUsageRecorderService } from '../usage/skill-usage-recorder.service';
import { SkillKeywordRouterService } from '../routing/skill-keyword-router.service';

@Injectable()
export class SkillTurnPreparationService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly versions: SkillVersionResolverService,
    private readonly catalogBuilder: SkillCatalogBuilder,
    private readonly loader: SkillLoaderService,
    private readonly usage: SkillUsageRecorderService,
    private readonly router: SkillKeywordRouterService,
  ) {}

  async prepare(input: {
    traceId: string;
    userId: string;
    agentId: string;
    conversationId: string;
    userMessage: string;
    externalContext?: Record<string, unknown> | null;
  }): Promise<SkillTurnPreparedContext> {
    const [policyRow, bindings, sessions] = await Promise.all([
      this.repository.client().cognitiveAgentSkillPolicy.findUnique({
        where: { agentId: input.agentId },
      }),
      this.repository.client().cognitiveAgentSkillBinding.findMany({
        where: {
          cognitiveAgentId: input.agentId,
          enabled: true,
          skill: {
            deletedAt: null,
            status: SkillStatus.ACTIVE,
            securityState: SkillSecurityState.CLEAR,
            OR: [
              { ownerUserId: input.userId },
              {
                source: { is: { kind: SkillSourceKind.BUILTIN } },
                installations: {
                  some: {
                    scopeType: SkillPrincipalType.USER,
                    scopeId: input.userId,
                    status: { not: SkillInstallationStatus.UNINSTALLED },
                    enabled: true,
                    removedAt: null,
                  },
                },
              },
            ],
          },
        },
        include: { skill: { include: { currentVersion: true } } },
      }),
      this.repository.client().conversationSkillActivation.findMany({
        where: {
          conversationId: input.conversationId,
          enabled: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          skill: {
            deletedAt: null,
            status: SkillStatus.ACTIVE,
            securityState: SkillSecurityState.CLEAR,
          },
        },
        include: {
          skill: { include: { currentVersion: true } },
          selectedVersion: true,
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);

    const policy = this.policy(policyRow);
    const defaultActivationMode = normalizeAgentDefaultActivationMode(
      policyRow?.defaultActivationMode,
    );
    const explicitSkillIds = this.explicitIds(input.externalContext);
    const associatedEntries: SkillCatalogEntry[] = [];
    const orderedBindings = normalizeStoredAgentSkillOrder(
      bindings
        .filter(
          (binding) => !isLegacyDisabledActivationMode(binding.activationMode),
        )
        .map((binding) => ({ ...binding, enabled: true })),
    );

    for (const binding of orderedBindings) {
      const version = await this.versions.forBinding(
        binding,
        binding.skill.currentVersionId,
      );
      if (!version || isLegacyDisabledActivationMode(binding.activationMode)) {
        continue;
      }
      const mode = resolveAgentSkillActivationMode(
        toAgentSkillActivationMode(binding.activationMode),
        defaultActivationMode,
      ) as SkillActivationMode;
      associatedEntries.push(
        this.entry(
          binding.skill,
          version,
          mode,
          'AGENT_BINDING',
          binding.priority,
          1,
        ),
      );
    }

    for (const session of sessions) {
      const version = session.selectedVersion ?? session.skill.currentVersion;
      if (!version || session.activationMode === SkillActivationMode.DISABLED) {
        continue;
      }
      associatedEntries.push(
        this.entry(
          session.skill,
          version,
          session.activationMode,
          'SESSION',
          session.priority,
          1,
        ),
      );
    }

    for (const skillId of explicitSkillIds) {
      const skill = await this.repository.findUserLibrarySkill(
        input.userId,
        skillId,
      );
      if (
        !skill?.currentVersion ||
        skill.deletedAt ||
        skill.status !== SkillStatus.ACTIVE ||
        skill.securityState !== SkillSecurityState.CLEAR
      ) {
        continue;
      }
      associatedEntries.push(
        this.entry(
          skill,
          skill.currentVersion,
          SkillActivationMode.MANUAL,
          'USER_EXPLICIT',
          10_000,
          1,
        ),
      );
    }

    const associatedIds = new Set(associatedEntries.map((entry) => entry.id));
    const discoverableEntries: SkillCatalogEntry[] = [];
    if (policy.publicDiscoveryEnabled && policy.publicCatalogLimit > 0) {
      const discoverable = await this.repository.client().skill.findMany({
        where: {
          id: { notIn: [...associatedIds] },
          deletedAt: null,
          status: SkillStatus.ACTIVE,
          securityState: SkillSecurityState.CLEAR,
          currentVersionId: { not: null },
          OR: [
            { ownerUserId: input.userId },
            {
              installations: {
                some: {
                  scopeType: SkillPrincipalType.USER,
                  scopeId: input.userId,
                  status: { not: SkillInstallationStatus.UNINSTALLED },
                  enabled: true,
                  removedAt: null,
                },
              },
            },
          ],
        },
        include: { currentVersion: true },
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
        take: Math.min(200, Math.max(64, policy.publicCatalogLimit * 8)),
      });
      const ranked = this.router.rank(
        input.userMessage,
        discoverable.filter((skill) => Boolean(skill.currentVersion)),
        policy.publicCatalogLimit,
      );
      for (const skill of ranked) {
        if (!skill.currentVersion) continue;
        discoverableEntries.push(
          this.entry(
            skill,
            skill.currentVersion,
            SkillActivationMode.AUTOMATIC,
            'DISCOVERABLE',
            skill.pinned ? 1 : 0,
            skill.relevance,
          ),
        );
      }
    }

    const { internalCatalog, discoveryCatalog } = this.catalogBuilder.build(
      associatedEntries,
      discoverableEntries,
      policy,
    );
    const preloadedSkills: ActivatedSkillDocument[] = [];
    let tokens = 0;

    for (const entry of internalCatalog.filter(
      (item) =>
        item.activationMode === SkillActivationMode.ALWAYS ||
        item.source === 'USER_EXPLICIT',
    )) {
      try {
        const loaded = await this.loader.load({
          skillId: entry.id,
          versionId: entry.versionId,
          activationMode: entry.activationMode,
          source: entry.source,
          userId: input.userId,
          agentId: input.agentId,
        });
        const estimate = estimateTokens(loaded.instructions);
        if (tokens + estimate > policy.instructionTokenBudget) continue;
        preloadedSkills.push(this.loader.expose(loaded));
        tokens += estimate;
        await this.usage.record({
          skillId: entry.id,
          skillVersionId: entry.versionId,
          userId: input.userId,
          agentId: input.agentId,
          conversationId: input.conversationId,
          traceId: input.traceId,
          activationMode: entry.activationMode,
          activationSource:
            entry.source === 'USER_EXPLICIT'
              ? SkillActivationSource.USER_EXPLICIT
              : SkillActivationSource.ALWAYS_PRELOAD,
          outcome: SkillUsageOutcome.LOADED,
          confidence: 1,
          tokenEstimate: estimate,
          dependencyStatus: loaded.dependencies,
        });
      } catch (reason) {
        await this.usage.record({
          skillId: entry.id,
          skillVersionId: entry.versionId,
          userId: input.userId,
          agentId: input.agentId,
          conversationId: input.conversationId,
          traceId: input.traceId,
          activationMode: entry.activationMode,
          activationSource:
            entry.source === 'USER_EXPLICIT'
              ? SkillActivationSource.USER_EXPLICIT
              : SkillActivationSource.ALWAYS_PRELOAD,
          outcome: SkillUsageOutcome.DEPENDENCY_MISSING,
          reason:
            reason instanceof Error ? reason.message : 'SKILL_PRELOAD_FAILED',
          confidence: 1,
        });
      }
    }

    return {
      traceId: input.traceId,
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      catalog: discoveryCatalog,
      internalCatalog,
      preloadedSkills,
      explicitSkillIds,
      policy,
    };
  }

  private policy(
    row: {
      maxCatalogEntries: number;
      catalogCharBudget: number;
      instructionTokenBudget: number;
      resourceTokenBudget: number;
      maxAutomaticSkills: number;
      maxResourceFiles: number;
      publicDiscoveryEnabled: boolean;
      publicCatalogLimit: number;
    } | null,
  ): SkillRuntimePolicy {
    const defaults = defaultSkillRuntimePolicy();
    return row
      ? {
          ...defaults,
          ...row,
        }
      : defaults;
  }

  private explicitIds(context?: Record<string, unknown> | null): string[] {
    const candidate =
      context?.explicitSkillIds ??
      (context?.skillRuntime && typeof context.skillRuntime === 'object'
        ? (context.skillRuntime as Record<string, unknown>).explicitSkillIds
        : undefined);
    return Array.isArray(candidate)
      ? [...new Set(candidate.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
  }

  private entry(
    skill: {
      id: string;
      slug: string;
      name: string;
      displayName: string;
      description: string;
      trustLevel: SkillCatalogEntry['trustLevel'];
      category: string | null;
      tags: string[];
    },
    version: { id: string; versionLabel: string },
    activationMode: SkillActivationMode,
    source: SkillCatalogEntry['source'],
    priority: number,
    relevance: number,
  ): SkillCatalogEntry {
    return {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      versionId: version.id,
      version: version.versionLabel,
      activationMode,
      source,
      priority,
      relevance,
      trustLevel: skill.trustLevel,
      category: skill.category,
      tags: skill.tags,
      estimatedTokens: estimateTokens(`${skill.displayName}\n${skill.description}`),
      exclusiveGroup: null,
      conflictKeys: [],
    };
  }
}
