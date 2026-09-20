                                                

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { SystemAgentModule } from '../system/systemagent.module';
import { CognitiveAgentModule } from '../cognitive/cognitive-agent.module';

@Module({
  imports: [
    PrismaModule,
    SystemAgentModule,
    CognitiveAgentModule,
  ],
  providers: [
    AgentService,
  ],
  controllers: [
    AgentController,
  ],
  exports: [
    AgentService,
    CognitiveAgentModule,
  ],
})
export class AgentModule {}
