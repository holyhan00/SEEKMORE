import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { SeekmoreAgentModule } from '../../seekmore-agent/seekmore-agent.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { CognitiveAgentController } from './cognitive-agent.controller';
import { CognitiveAgentService } from './cognitive-agent.service';
import { CognitiveAgentPolicy } from './cognitive-agent.policy';
import { CognitiveAgentPurgeService } from './deletion/cognitive-agent-purge.service';

@Module({
  imports: [PrismaModule, SeekmoreAgentModule, KnowledgeModule],
  controllers: [CognitiveAgentController],
  providers: [
    CognitiveAgentService,
    CognitiveAgentPolicy,
    CognitiveAgentPurgeService,
  ],
  exports: [CognitiveAgentService],
})
export class CognitiveAgentModule {}
