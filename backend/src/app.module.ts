                    
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';

import { ChatModule } from './modules/chat/chat.module';
import { ChatTitleModule } from './modules/chat/chat-title/chat-title.module';
import { UserModule } from './modules/user/user.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { SystemAgentModule } from './modules/agent/system/systemagent.module';
import { AgentModule } from './modules/agent/list/agent.module';
import { ToolsModule } from './tools/tools.module';

import { HealthController } from './health.controller';

import { LLMModule } from './modules/llm/llm.module';

import { SeekmoreAgentModule } from './modules/seekmore-agent/seekmore-agent.module';
import { RuntimeWorkspaceModule } from './modules/workspace/runtime-workspace.module';
import { ObjectRuntimeModule } from './modules/object-runtime/object-runtime.module';
import { DocumentParserModule } from './modules/document-parser/document-parser.module';
import { SkillModule } from './modules/agent/skill/skill.module';
import { MemoryModule } from './modules/memory/memory.module';
import { LlmSettingsModule } from './modules/llm-settings/llm-settings.module';
import { MediaAiModule } from './modules/media-ai/media-ai.module';
import { WebSearchSettingsModule } from './modules/web-search-settings/web-search-settings.module';
import { McpRuntimeModule } from './modules/mcp/mcp-runtime.module';
import { ExploreModule } from './modules/explore/explore.module';
import { GrowModule } from './modules/grow/nest/grow.module';
import { SystemGrowClock } from './modules/grow/ports/grow-clock.port';
import { GrowNestLoggerAdapter } from './modules/grow/infrastructure/logging/grow-nest-logger.adapter';
import { PrismaGrowReviewRepository } from './modules/grow/infrastructure/prisma/prisma-grow-review.repository';
import { PrismaGrowObserverStateRepository } from './modules/grow/infrastructure/prisma/prisma-grow-observer-state.repository';
import { PrismaGrowEffectStateRepository } from './modules/grow/infrastructure/prisma/prisma-grow-effect-state.repository';
import { SeekmoreGrowEvidenceAdapter } from './modules/grow/infrastructure/evidence/seekmore-grow-evidence.adapter';
import { SeekmoreGrowFocusAgentAdapter } from './modules/grow/infrastructure/agent/seekmore-grow-focus-agent.adapter';
import { SeekmoreGrowSkillCatalogAdapter } from './modules/grow/infrastructure/skill/seekmore-grow-skill-catalog.adapter';
import { SeekmoreGrowSkillAuthoringAdapter } from './modules/grow/infrastructure/skill/seekmore-grow-skill-authoring.adapter';
import { SeekmoreGrowSkillValidationAdapter } from './modules/grow/infrastructure/skill/seekmore-grow-skill-validation.adapter';
import { SeekmoreGrowSkillPublicationAdapter } from './modules/grow/infrastructure/skill/seekmore-grow-skill-publication.adapter';
import { SeekmoreGrowMemoryAdapter } from './modules/grow/infrastructure/memory/seekmore-grow-memory.adapter';
import { SeekmoreGrowProfessionalStudyAdapter } from './modules/grow/infrastructure/study/seekmore-grow-professional-study.adapter';
import { AutomationRuntimeModule } from './modules/automation/automation-runtime.module';
import { LocalizationModule } from './modules/localization/localization.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),

    PrismaModule,
    LocalizationModule,
    LlmSettingsModule,
    MediaAiModule,
    WebSearchSettingsModule,
    McpRuntimeModule,
    ExploreModule,
    LLMModule,
    SeekmoreAgentModule,
    RuntimeWorkspaceModule,
    ObjectRuntimeModule,
    SkillModule,
    DocumentParserModule,

    ChatModule,
    ChatTitleModule,
    UserModule,
    RedisModule,
    AuthModule,
    SystemAgentModule,
    AgentModule,
    ToolsModule,
    MemoryModule,
    AutomationRuntimeModule,
    GrowModule.register({
      imports: [
        PrismaModule,
        SeekmoreAgentModule,
        SkillModule,
        MemoryModule,
        ToolsModule,
      ],
      policy: {
        enabled: process.env.GROW_ENABLED !== 'false',
        trigger: {
          toolIterationInterval: Math.max(1, Number(process.env.GROW_TOOL_ITERATION_INTERVAL ?? 10)),
          minimumIntervalMs: Math.max(0, Number(process.env.GROW_MINIMUM_INTERVAL_MS ?? 300_000)),
          maximumRunsPerDay: Math.max(1, Number(process.env.GROW_MAX_RUNS_PER_DAY ?? 20)),
        },
        focus: {
          maxIterations: Math.max(1, Number(process.env.GROW_FOCUS_MAX_ITERATIONS ?? 8)),
          tokenBudget: Math.max(1_000, Number(process.env.GROW_FOCUS_TOKEN_BUDGET ?? 12_000)),
          timeoutMs: Math.max(30_000, Number(process.env.GROW_FOCUS_TIMEOUT_MS ?? 120_000)),
        },
        publication: {
          automatic: process.env.GROW_AUTO_PUBLISH !== 'false',
          automaticRollback: process.env.GROW_AUTO_ROLLBACK !== 'false',
        },
        professionalStudy: {
          enabled: process.env.GROW_PROFESSIONAL_STUDY !== 'false',
        },
      },
      providers: {
        clock: { provide: SystemGrowClock, useValue: new SystemGrowClock() },
        logger: GrowNestLoggerAdapter,
        reviewRepository: PrismaGrowReviewRepository,
        observerState: PrismaGrowObserverStateRepository,
        evidence: SeekmoreGrowEvidenceAdapter,
        effectState: PrismaGrowEffectStateRepository,
        skillCatalog: SeekmoreGrowSkillCatalogAdapter,
        focusAgent: SeekmoreGrowFocusAgentAdapter,
        professionalStudy: SeekmoreGrowProfessionalStudyAdapter,
        memory: SeekmoreGrowMemoryAdapter,
        skillAuthoring: SeekmoreGrowSkillAuthoringAdapter,
        skillValidation: SeekmoreGrowSkillValidationAdapter,
        skillPublication: SeekmoreGrowSkillPublicationAdapter,
      },
    }),
  ],
  controllers: [AppController, HealthController],
})
export class AppModule {}
