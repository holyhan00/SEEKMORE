import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { WebSearchSettingsController } from './api/web-search-settings.controller';
import { WebSearchSettingsService } from './application/web-search-settings.service';
import { UserWebSearchSettingsRepository } from './persistence/user-web-search-settings.repository';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [WebSearchSettingsController],
  providers: [WebSearchSettingsService, UserWebSearchSettingsRepository],
  exports: [WebSearchSettingsService],
})
export class WebSearchSettingsModule {}
