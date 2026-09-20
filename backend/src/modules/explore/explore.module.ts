import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ExploreController } from './explore.controller';
import { ExploreQueryService } from './explore-query.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExploreController],
  providers: [ExploreQueryService],
  exports: [ExploreQueryService],
})
export class ExploreModule {}
