import {
  Global,
  Module,
} from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LocaleResolverService } from './locale-resolver.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [LocaleResolverService],
  exports: [LocaleResolverService],
})
export class LocalizationModule {}
