import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { DocumentParserModule } from '../../document-parser/document-parser.module';
import { AudioObjectProcessor } from '../object-processing/audio-object.processor';
import { DocumentObjectProcessor } from '../object-processing/document-object.processor';
import { ImageObjectProcessor } from '../object-processing/image-object.processor';
import { ObjectProcessingRegistry } from '../object-processing/object-processing.registry';
import { RuntimeObjectCapabilityPolicyService } from '../object-processing/runtime-object-capability-policy.service';
import { MessageObjectLinkRepository } from '../message-object/message-object.repository';
import { MessageObjectLinkService } from '../message-object/message-object.service';
import { RuntimeObjectAccessPolicyService } from './object-access-policy.service';
import { ObjectCardMapper } from './object-card.mapper';
import { RuntimeObjectKindService } from './object-kind.service';
import { RuntimeObjectRepository } from './object.repository';
import { RuntimeObjectSecurityPolicyService } from './object-security-policy.service';
import { RuntimeObjectService } from './object.service';
import { RuntimeObjectStorageService } from './object-storage.service';
import { RuntimeObjectVersionService } from './object-version.service';

const providers = [
  RuntimeObjectRepository,
  RuntimeObjectService,
  RuntimeObjectKindService,
  RuntimeObjectSecurityPolicyService,
  RuntimeObjectStorageService,
  RuntimeObjectVersionService,
  RuntimeObjectAccessPolicyService,
  ObjectCardMapper,
  DocumentObjectProcessor,
  ImageObjectProcessor,
  AudioObjectProcessor,
  ObjectProcessingRegistry,
  RuntimeObjectCapabilityPolicyService,
  MessageObjectLinkRepository,
  MessageObjectLinkService,
];

@Module({
  imports: [PrismaModule, DocumentParserModule],
  providers,
  exports: providers,
})
export class RuntimeObjectModule {}
