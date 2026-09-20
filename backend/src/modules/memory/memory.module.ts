                                              
import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LLMModule } from '../llm/llm.module';

import { MemoryController } from './api/controllers/memory.controller';
import { MemoryAdminController } from './api/controllers/memory.admin.controller';
import { MemoryFacade } from './facade/memory.facade';
import { MemoryReadRuntime } from './kernel/memory-read.runtime';
import { MemoryWriteRuntime } from './kernel/memory-write.runtime';
import { MemoryGovernanceRuntime } from './kernel/memory-governance.runtime';
import { MemoryRepository } from './storage/prisma/memory.repository';
import { MemoryCandidateNormalizer } from './extract/memory-candidate-normalizer.service';
import { ConfirmedMemoryExtractor } from './extract/confirmed-memory.extractor';
import { LlmMemoryExtractor } from './extract/llm-memory.extractor';
import { MemoryScopeResolver } from './governance/memory-scope-resolver.service';
import { MemoryPrivacyPolicy } from './governance/privacy-policy.service';
import { MemoryAdmissionPolicy } from './governance/admission-policy.service';
import { MemoryConflictResolver } from './governance/conflict-resolver.service';
import { ImplicitMemoryPolicy } from './governance/implicit-memory-policy.service';
import { MemoryRetentionPolicy } from './governance/retention-policy.service';
import { MemoryRetentionService } from './governance/memory-retention.service';
import { MemoryTrustGate } from './governance/trust-gate.service';
import { MemoryPromotionPolicy } from './governance/promotion-policy.service';
import { MemoryRestoreService } from './governance/memory-restore.service';
import { MemoryDecayPolicy } from './governance/memory-decay-policy.service';
import { MemoryDecayService } from './governance/memory-decay.service';
import { MemoryQueryPlanner } from './retrieval/memory-query-planner.service';
import { MemoryReranker } from './retrieval/memory-reranker.service';
import { MemoryRetriever } from './retrieval/memory-retriever.service';
import { MemoryContextComposer } from './retrieval/memory-context-composer.service';
import { MemoryDecisionAuditService } from './observability/memory-decision-audit.service';
import { MemoryLogger } from './observability/memory.logger';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), forwardRef(() => LLMModule)],
  controllers: [MemoryController, MemoryAdminController],
  providers: [
    MemoryFacade,
    MemoryReadRuntime,
    MemoryWriteRuntime,
    MemoryGovernanceRuntime,
    MemoryRepository,
    MemoryCandidateNormalizer,
    ConfirmedMemoryExtractor,
    LlmMemoryExtractor,
    MemoryScopeResolver,
    MemoryPrivacyPolicy,
    MemoryAdmissionPolicy,
    MemoryConflictResolver,
    ImplicitMemoryPolicy,
    MemoryPromotionPolicy,
    MemoryRetentionPolicy,
    MemoryRetentionService,
    MemoryRestoreService,
    MemoryDecayPolicy,
    MemoryDecayService,
    MemoryTrustGate,
    MemoryQueryPlanner,
    MemoryReranker,
    MemoryRetriever,
    MemoryContextComposer,
    MemoryDecisionAuditService,
    MemoryLogger,
  ],
  exports: [MemoryFacade, MemoryReadRuntime, MemoryWriteRuntime, MemoryGovernanceRuntime],
})
export class MemoryModule {}