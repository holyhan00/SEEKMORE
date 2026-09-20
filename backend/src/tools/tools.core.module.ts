                                         

import { Module } from '@nestjs/common';
import { ToolsRegistry } from './toolsregistry';
import { ToolsDispatcher } from './toolsdispatcher';
import { RuntimeEventsModule } from '../modules/chat/runtime-events/runtime-events.module';
import { RuntimeEventToolObserver } from './observers/runtime-event.tool-observer';
import { RedisModule } from '../modules/redis/redis.module';
import { ToolSchemaValidatorService } from './schema/tool-schema-validator.service';
import { ToolIdempotencyStore } from './idempotency/tool-idempotency.store';
import { ToolUserPreferenceService } from './preferences/tool-user-preference.service';

@Module({
  imports: [RuntimeEventsModule, RedisModule],
  providers: [
    ToolSchemaValidatorService,
    ToolIdempotencyStore,
    ToolUserPreferenceService,
    ToolsRegistry,
    ToolsDispatcher,
    RuntimeEventToolObserver,
  ],
  exports: [
    ToolUserPreferenceService,
    ToolsRegistry,
    ToolsDispatcher,
    RuntimeEventToolObserver,
  ],
})
export class ToolsCoreModule {}