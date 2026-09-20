import { Global, Module } from '@nestjs/common';
import { ChildProcessTerminationService } from './child-process-termination.service';
import { TurnResourceRegistry } from './turn-resource.registry';

@Global()
@Module({
  providers: [TurnResourceRegistry, ChildProcessTerminationService],
  exports: [TurnResourceRegistry, ChildProcessTerminationService],
})
export class RuntimeCancellationModule {}
