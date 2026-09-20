import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ToolsCoreModule } from '../../../tools/tools.core.module';
import { SkillController } from './api/skill.controller';
import { SkillFileController } from './api/skill-file.controller';
import { SkillBindingController } from './api/skill-binding.controller';
import { SkillRepository } from './persistence/skill.repository';
import { SkillAccessService } from './application/skill-access.service';
import { SkillQueryService } from './application/skill-query.service';
import { SkillCommandService } from './application/skill-command.service';
import { SkillVersionService } from './application/skill-version.service';
import { SkillLifecycleService } from './application/skill-lifecycle.service';
import { SkillDependencyService } from './application/skill-dependency.service';
import { SkillBindingService } from './application/skill-binding.service';
import { SkillSessionService } from './application/skill-session.service';
import { SkillTestService } from './application/skill-test.service';
import { SkillSchemaService } from './application/skill-schema.service';
import { SkillGovernanceService } from './application/skill-governance.service';
import { SkillSourceService } from './application/skill-source.service';
import { SkillFrontmatterParser } from './validation/skill-frontmatter.parser';
import { SkillValidationService } from './validation/skill-validation.service';
import { SkillPathPolicy } from './security/skill-path-policy';
import { SkillPackageScannerService } from './security/skill-package-scanner.service';
import { SkillFileStorageService } from './files/skill-file-storage.service';
import { SKILL_FILE_STORAGE } from './files/skill-file-storage.port';
import { SkillFileService } from './files/skill-file.service';
import { SkillDependencyResolverService } from './runtime/skill-dependency-resolver.service';
import { SkillTurnPreparationService } from './runtime/skill-turn-preparation.service';
import { SkillTurnContextStore } from './runtime/skill-turn-context.store';
import { SkillVersionResolverService } from './resolution/skill-version-resolver.service';
import { SkillResolverService } from './resolution/skill-resolver.service';
import { SkillConflictResolverService } from './resolution/skill-conflict-resolver.service';
import { SkillCatalogBuilder } from './catalog/skill-catalog.builder';
import { SkillLoaderService } from './loading/skill-loader.service';
import { SkillResourceLoaderService } from './loading/skill-resource-loader.service';
import { SkillAuditService } from './usage/skill-audit.service';
import { SkillUsageRecorderService } from './usage/skill-usage-recorder.service';
import { SkillViewTool } from './tools/skill-view.tool';
import { SkillReadResourceTool } from './tools/skill-read-resource.tool';
import { SkillSearchTool } from './tools/skill-search.tool';
import { SkillQueryNormalizerService } from './routing/skill-query-normalizer.service';
import { SkillKeywordRouterService } from './routing/skill-keyword-router.service';
import { SkillSearchService } from './routing/skill-search.service';
import { SkillSourceAdapterRegistry } from './source/skill-source-adapter.registry';
import { InlineSkillSourceAdapter } from './source/inline-skill-source.adapter';
import { UploadSkillSourceAdapter } from './source/upload-skill-source.adapter';
import { RepositorySkillSourceAdapter } from './source/repository-skill-source.adapter';
import { ImportedSkillSourceAdapter } from './source/imported-skill-source.adapter';
import { BuiltinSkillSourceAdapter } from './source/builtin-skill-source.adapter';
import { SkillGenerationController } from './api/skill-generation.controller';
import { SkillImportController } from './api/skill-import.controller';
import { SkillGenerationPromptBuilder } from './generation/skill-generation-prompt.builder';
import { SkillGenerationResultParser } from './generation/skill-generation-result.parser';
import { SkillGenerationAgentBridge } from './generation/skill-generation-agent.bridge';
import { SkillGenerationService } from './generation/skill-generation.service';
import { SkillImportPackageReader } from './import/skill-import-package-reader.service';
import { SkillImportService } from './import/skill-import.service';
import { SkillApiSerializationInterceptor } from './api/interceptors/skill-api-serialization.interceptor';
import { SkillCapabilityController } from './api/skill-capability.controller';
import { SkillCapabilityCatalogService } from './capability/skill-capability-catalog.service';
import { SkillCapabilityResolverService } from './capability/skill-capability-resolver.service';
import { SkillDeletionPolicyService } from './application/skill-deletion-policy.service';
import { SkillDocumentValidator } from './validation/skill-document.validator';
import { SkillAcceptancePolicy } from './validation/skill-acceptance.policy';
import { SkillCreationService } from './application/skill-creation.service';
import { SkillPurgeService } from './deletion/skill-purge.service';


@Module({
  imports: [PrismaModule, ToolsCoreModule],
  controllers: [
    SkillController,
    SkillFileController,
    SkillBindingController,
    SkillGenerationController,
    SkillImportController,
    SkillCapabilityController,
  ],
  providers: [
    SkillRepository,
    SkillAccessService,
    SkillQueryService,
    SkillCommandService,
    SkillVersionService,
    SkillLifecycleService,
    SkillDependencyService,
    SkillBindingService,
    SkillSessionService,
    SkillTestService,
    SkillSchemaService,
    SkillGovernanceService,
    SkillSourceService,
    SkillSourceAdapterRegistry,
    InlineSkillSourceAdapter,
    UploadSkillSourceAdapter,
    RepositorySkillSourceAdapter,
    ImportedSkillSourceAdapter,
    BuiltinSkillSourceAdapter,
    SkillFrontmatterParser,
    SkillDocumentValidator,
    SkillAcceptancePolicy,
    SkillValidationService,
    SkillCreationService,
    SkillPathPolicy,
    SkillPackageScannerService,
    SkillFileStorageService,
    { provide: SKILL_FILE_STORAGE, useExisting: SkillFileStorageService },
    SkillFileService,
    SkillDependencyResolverService,
    SkillTurnPreparationService,
    SkillTurnContextStore,
    SkillVersionResolverService,
    SkillResolverService,
    SkillConflictResolverService,
    SkillCatalogBuilder,
    SkillLoaderService,
    SkillResourceLoaderService,
    SkillAuditService,
    SkillUsageRecorderService,
    SkillViewTool,
    SkillReadResourceTool,
    SkillSearchTool,
    SkillQueryNormalizerService,
    SkillKeywordRouterService,
    SkillSearchService,
    SkillGenerationPromptBuilder,
    SkillGenerationResultParser,
    SkillGenerationAgentBridge,
    SkillGenerationService,
    SkillImportPackageReader,
    SkillImportService,
    SkillApiSerializationInterceptor,
    SkillCapabilityCatalogService,
    SkillCapabilityResolverService,
    SkillDeletionPolicyService,
    SkillPurgeService,
  ],
  exports: [
    SkillTurnPreparationService,
    SkillTurnContextStore,
    SkillViewTool,
    SkillReadResourceTool,
    SkillSearchTool,
    SkillQueryNormalizerService,
    SkillKeywordRouterService,
    SkillSearchService,
    SkillBindingService,
    SkillQueryService,
    SkillCreationService,
    SkillVersionService,
    SkillLifecycleService,
    SkillValidationService,
    SkillRepository,
    SkillUsageRecorderService,
  ],
})
export class SkillModule {}
