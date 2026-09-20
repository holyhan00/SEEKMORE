                                                            

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RuntimeWorkspaceResolver } from './runtime-workspace-resolver.service';
import { RuntimeWorkspaceService } from './runtime-workspace.service';
import { RuntimeWorkspaceController } from './runtime-workspace.controller';

import { RuntimeTraceModule } from '../../common/trace/runtime-trace.module';

@Module({
  imports: [RuntimeTraceModule, PrismaModule],
  controllers: [RuntimeWorkspaceController],
  providers: [RuntimeWorkspaceResolver, RuntimeWorkspaceService],
  exports: [RuntimeWorkspaceResolver, RuntimeWorkspaceService],
})
export class RuntimeWorkspaceModule {}
