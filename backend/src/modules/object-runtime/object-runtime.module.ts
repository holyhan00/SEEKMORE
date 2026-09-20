import { Module } from '@nestjs/common';
import { RuntimeObjectDownloadController } from './object-download.controller';
import { ObjectRuntimeController } from './object-runtime.controller';
import { RuntimeObjectModule } from './object/object.module';
import { RuntimeObjectPreviewService } from './preview/object-preview.service';

@Module({
  imports: [RuntimeObjectModule],
  controllers: [ObjectRuntimeController, RuntimeObjectDownloadController],
  providers: [RuntimeObjectPreviewService],
  exports: [RuntimeObjectModule],
})
export class ObjectRuntimeModule {}
