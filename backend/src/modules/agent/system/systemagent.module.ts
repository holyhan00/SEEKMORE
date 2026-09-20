                                                         

import {
  Module,
} from '@nestjs/common';

import {
  PrismaModule,
} from '../../../../prisma/prisma.module';
import {
  SystemAgentService,
} from './systemagent.service';

@Module({
  imports: [
    PrismaModule,
  ],
  providers: [
    SystemAgentService,
  ],
  exports: [
    SystemAgentService,
  ],
})
export class SystemAgentModule {}
