import type {
  DynamicModule,
  ModuleMetadata,
  Provider,
} from '@nestjs/common';
import { Module } from '@nestjs/common';
import { GrowActionExecutorService } from '../core/grow-action-executor.service';
import { GrowDecisionGuardService } from '../core/grow-decision-guard.service';
import { GrowEvidenceSanitizerService } from '../core/grow-evidence-sanitizer.service';
import { GrowEffectTrackerService } from '../core/grow-effect-tracker.service';
import { GrowFocusContextService } from '../core/grow-focus-context.service';
import { GrowFocusPromptBuilder } from '../core/grow-focus-prompt.builder';
import { GrowFocusResultValidator } from '../core/grow-focus-result.validator';
import { GrowObserverService } from '../core/grow-observer.service';
import { GrowOrchestratorService } from '../core/grow-orchestrator.service';
import {
  mergeGrowPolicy,
  type GrowPolicy,
  type GrowPolicyOverride,
} from '../core/grow-policy';
import { GrowPublicationCoordinatorService } from '../core/grow-publication-coordinator.service';
import { GrowReviewProcessorService } from '../core/grow-review-processor.service';
import { GrowTriggerPolicyService } from '../core/grow-trigger-policy.service';
import { GrowSkillUsageSettlementService } from '../infrastructure/usage/grow-skill-usage-settlement.service';
import { GrowOutboxDispatcherService } from '../scheduling/grow-outbox-dispatcher.service';
import { GrowReviewWorkerService } from '../scheduling/grow-review-worker.service';
import type { GrowClockPort } from '../ports/grow-clock.port';
import type { GrowEvidencePort } from '../ports/grow-evidence.port';
import type { GrowEffectStatePort } from '../ports/grow-effect-state.port';
import type { GrowFocusAgentPort } from '../ports/grow-focus-agent.port';
import type { GrowLoggerPort } from '../ports/grow-logger.port';
import type { GrowMemoryPort } from '../ports/grow-memory.port';
import type { GrowObserverStatePort } from '../ports/grow-observer-state.port';
import type { GrowProfessionalStudyPort } from '../ports/grow-professional-study.port';
import type { GrowReviewRepositoryPort } from '../ports/grow-review-repository.port';
import type { GrowSkillAuthoringPort } from '../ports/grow-skill-authoring.port';
import type { GrowSkillCatalogPort } from '../ports/grow-skill-catalog.port';
import type {
  GrowSkillPublicationPort,
  GrowSkillValidationPort,
} from '../ports/grow-skill-publication.port';
import {
  GROW_CLOCK,
  GROW_EVIDENCE,
  GROW_EFFECT_STATE,
  GROW_FOCUS_AGENT,
  GROW_LOGGER,
  GROW_MEMORY,
  GROW_OBSERVER_STATE,
  GROW_POLICY,
  GROW_PROFESSIONAL_STUDY,
  GROW_REVIEW_REPOSITORY,
  GROW_SKILL_AUTHORING,
  GROW_SKILL_CATALOG,
  GROW_SKILL_PUBLICATION,
  GROW_SKILL_VALIDATION,
} from './grow.tokens';

export interface GrowModuleRegistration {
  imports?: ModuleMetadata['imports'];
  policy?: GrowPolicyOverride;
  providers: {
    clock: Provider;
    logger: Provider;
    reviewRepository: Provider;
    observerState: Provider;
    evidence: Provider;
    effectState: Provider;
    skillCatalog: Provider;
    focusAgent: Provider;
    professionalStudy: Provider;
    memory: Provider;
    skillAuthoring: Provider;
    skillValidation: Provider;
    skillPublication: Provider;
  };
}

@Module({})
export class GrowModule {
  static register(options: GrowModuleRegistration): DynamicModule {
    const policy = mergeGrowPolicy(options.policy);
    const adapters: Provider[] = [
      this.bindProvider(GROW_CLOCK, options.providers.clock),
      this.bindProvider(GROW_LOGGER, options.providers.logger),
      this.bindProvider(GROW_REVIEW_REPOSITORY, options.providers.reviewRepository),
      this.bindProvider(GROW_OBSERVER_STATE, options.providers.observerState),
      this.bindProvider(GROW_EVIDENCE, options.providers.evidence),
      this.bindProvider(GROW_EFFECT_STATE, options.providers.effectState),
      this.bindProvider(GROW_SKILL_CATALOG, options.providers.skillCatalog),
      this.bindProvider(GROW_FOCUS_AGENT, options.providers.focusAgent),
      this.bindProvider(GROW_PROFESSIONAL_STUDY, options.providers.professionalStudy),
      this.bindProvider(GROW_MEMORY, options.providers.memory),
      this.bindProvider(GROW_SKILL_AUTHORING, options.providers.skillAuthoring),
      this.bindProvider(GROW_SKILL_VALIDATION, options.providers.skillValidation),
      this.bindProvider(GROW_SKILL_PUBLICATION, options.providers.skillPublication),
      { provide: GROW_POLICY, useValue: policy },
    ];

    const coreProviders: Provider[] = [
      GrowFocusPromptBuilder,
      GrowFocusResultValidator,
      {
        provide: GrowEvidenceSanitizerService,
        inject: [GROW_LOGGER],
        useFactory: (logger: GrowLoggerPort) =>
          new GrowEvidenceSanitizerService(logger),
      },
      {
        provide: GrowTriggerPolicyService,
        inject: [GROW_POLICY, GROW_CLOCK, GROW_LOGGER],
        useFactory: (
          growPolicy: GrowPolicy,
          clock: GrowClockPort,
          logger: GrowLoggerPort,
        ) => new GrowTriggerPolicyService(growPolicy, clock, logger),
      },
      {
        provide: GrowFocusContextService,
        inject: [GROW_SKILL_CATALOG, GROW_POLICY, GROW_LOGGER],
        useFactory: (
          catalog: GrowSkillCatalogPort,
          growPolicy: GrowPolicy,
          logger: GrowLoggerPort,
        ) => new GrowFocusContextService(catalog, growPolicy, logger),
      },
      {
        provide: GrowDecisionGuardService,
        inject: [GROW_POLICY, GROW_LOGGER],
        useFactory: (growPolicy: GrowPolicy, logger: GrowLoggerPort) =>
          new GrowDecisionGuardService(growPolicy, logger),
      },
      {
        provide: GrowActionExecutorService,
        inject: [GROW_SKILL_AUTHORING, GROW_SKILL_CATALOG, GROW_MEMORY, GrowDecisionGuardService, GROW_LOGGER],
        useFactory: (
          authoring: GrowSkillAuthoringPort,
          catalog: GrowSkillCatalogPort,
          memory: GrowMemoryPort,
          guard: GrowDecisionGuardService,
          logger: GrowLoggerPort,
        ) => new GrowActionExecutorService(authoring, catalog, memory, guard, logger),
      },
      {
        provide: GrowEffectTrackerService,
        inject: [GROW_EFFECT_STATE, GROW_SKILL_PUBLICATION, GROW_POLICY, GROW_CLOCK, GROW_LOGGER],
        useFactory: (
          state: GrowEffectStatePort,
          publication: GrowSkillPublicationPort,
          growPolicy: GrowPolicy,
          clock: GrowClockPort,
          logger: GrowLoggerPort,
        ) => new GrowEffectTrackerService(state, publication, growPolicy, clock, logger),
      },
      {
        provide: GrowPublicationCoordinatorService,
        inject: [
          GROW_SKILL_VALIDATION,
          GROW_SKILL_PUBLICATION,
          GROW_SKILL_AUTHORING,
          GROW_POLICY,
          GrowEffectTrackerService,
          GROW_LOGGER,
        ],
        useFactory: (
          validation: GrowSkillValidationPort,
          publication: GrowSkillPublicationPort,
          authoring: GrowSkillAuthoringPort,
          growPolicy: GrowPolicy,
          effectTracker: GrowEffectTrackerService,
          logger: GrowLoggerPort,
        ) =>
          new GrowPublicationCoordinatorService(
            validation,
            publication,
            authoring,
            growPolicy,
            effectTracker,
            logger,
          ),
      },
      {
        provide: GrowObserverService,
        inject: [
          GROW_EVIDENCE,
          GrowEvidenceSanitizerService,
          GROW_OBSERVER_STATE,
          GROW_REVIEW_REPOSITORY,
          GrowTriggerPolicyService,
          GROW_POLICY,
          GROW_CLOCK,
          GROW_LOGGER,
        ],
        useFactory: (
          evidence: GrowEvidencePort,
          sanitizer: GrowEvidenceSanitizerService,
          state: GrowObserverStatePort,
          reviews: GrowReviewRepositoryPort,
          trigger: GrowTriggerPolicyService,
          growPolicy: GrowPolicy,
          clock: GrowClockPort,
          logger: GrowLoggerPort,
        ) =>
          new GrowObserverService(
            evidence,
            sanitizer,
            state,
            reviews,
            trigger,
            growPolicy,
            clock,
            logger,
          ),
      },
      {
        provide: GrowReviewProcessorService,
        inject: [
          GROW_REVIEW_REPOSITORY,
          GrowFocusContextService,
          GROW_FOCUS_AGENT,
          GrowFocusPromptBuilder,
          GrowFocusResultValidator,
          GrowDecisionGuardService,
          GROW_PROFESSIONAL_STUDY,
          GrowActionExecutorService,
          GrowPublicationCoordinatorService,
          GROW_POLICY,
          GROW_CLOCK,
          GROW_LOGGER,
        ],
        useFactory: (
          reviews: GrowReviewRepositoryPort,
          context: GrowFocusContextService,
          focusAgent: GrowFocusAgentPort,
          promptBuilder: GrowFocusPromptBuilder,
          validator: GrowFocusResultValidator,
          guard: GrowDecisionGuardService,
          study: GrowProfessionalStudyPort,
          actions: GrowActionExecutorService,
          publication: GrowPublicationCoordinatorService,
          growPolicy: GrowPolicy,
          clock: GrowClockPort,
          logger: GrowLoggerPort,
        ) =>
          new GrowReviewProcessorService(
            reviews,
            context,
            focusAgent,
            promptBuilder,
            validator,
            guard,
            study,
            actions,
            publication,
            growPolicy,
            clock,
            logger,
          ),
      },
      {
        provide: GrowOrchestratorService,
        inject: [GrowObserverService, GrowReviewProcessorService, GROW_LOGGER],
        useFactory: (
          observer: GrowObserverService,
          processor: GrowReviewProcessorService,
          logger: GrowLoggerPort,
        ) => new GrowOrchestratorService(observer, processor, logger),
      },
      GrowSkillUsageSettlementService,
      GrowOutboxDispatcherService,
      GrowReviewWorkerService,
    ];

    return {
      module: GrowModule,
      imports: options.imports ?? [],
      providers: [...adapters, ...coreProviders],
      exports: [
        GrowOrchestratorService,
        GrowObserverService,
        GrowReviewProcessorService,
        GrowEffectTrackerService,
      ],
    };
  }

  private static bindProvider(token: symbol, provider: Provider): Provider {
    if (
      typeof provider === 'object' &&
      provider !== null &&
      'provide' in provider
    ) {
      const source = provider as Exclude<Provider, Function>;
      if ('useClass' in source) return { provide: token, useClass: source.useClass };
      if ('useValue' in source) return { provide: token, useValue: source.useValue };
      if ('useExisting' in source) return { provide: token, useExisting: source.useExisting };
      if ('useFactory' in source) {
        return {
          provide: token,
          useFactory: source.useFactory,
          inject: source.inject,
        };
      }
    }
    return { provide: token, useClass: provider as never };
  }
}