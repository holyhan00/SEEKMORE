import { Global, Module } from '@nestjs/common';
import { RuntimeFlowTraceLogger } from './runtime-flow-trace.logger';

@Global()
@Module({
  providers: [RuntimeFlowTraceLogger],
  exports: [RuntimeFlowTraceLogger],
})
export class RuntimeTraceModule {}
