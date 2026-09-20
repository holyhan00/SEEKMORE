import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import { CurrentUserId } from '../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../common/guards/jwt.guard';
import { CognitiveAgentService } from './cognitive-agent.service';
import { COGNITIVE_KNOWLEDGE_UPLOAD_BATCH_SIZE } from './cognitive-agent.policy';
import { CognitiveAgentPurgeService } from './deletion/cognitive-agent-purge.service';
import type { CognitiveAgentPurgeResult } from './deletion/cognitive-agent-purge.service';
import {
  CreateCognitiveAgentDto,
  TestCognitiveAgentDto,
  UpdateCognitiveAgentDto,
  UploadCognitiveAgentKnowledgeDto,
} from './cognitive-agent.dto';

type CognitiveProfileUploadFiles = {
  avatarFile?: Express.Multer.File[];
  coverFile?: Express.Multer.File[];
};

type CognitiveKnowledgeUploadFiles = {
  knowledgeObjects?: Express.Multer.File[];
};

const PROFILE_FIELDS = [
  { name: 'avatarFile', maxCount: 1 },
  { name: 'coverFile', maxCount: 1 },
];

const KNOWLEDGE_FIELDS = [
  {
    name: 'knowledgeObjects',
    maxCount: COGNITIVE_KNOWLEDGE_UPLOAD_BATCH_SIZE,
  },
];

const PROFILE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2,
  },
};

const KNOWLEDGE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: COGNITIVE_KNOWLEDGE_UPLOAD_BATCH_SIZE,
  },
};

@Controller('agents/cognitive')
@UseGuards(JwtGuard)
export class CognitiveAgentController {
  constructor(
    private readonly service: CognitiveAgentService,
    private readonly purge: CognitiveAgentPurgeService,
  ) {}

  @Post()
  @UseInterceptors(FileFieldsInterceptor(PROFILE_FIELDS, PROFILE_UPLOAD_OPTIONS))
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateCognitiveAgentDto,
    @UploadedFiles() files: CognitiveProfileUploadFiles = {},
  ) {
    return this.service.create(userId, dto, {
      avatarFile: files.avatarFile?.[0] ?? null,
      coverFile: files.coverFile?.[0] ?? null,
    });
  }

  @Get('my')
  findMy(@CurrentUserId() userId: string) {
    return this.service.findMy(userId);
  }

  @Get('deleted')
  findDeleted(@CurrentUserId() userId: string) {
    return this.service.findDeleted(userId);
  }

  @Get('capability-options')
  capabilityOptions() {
    return this.service.getCapabilityOptions();
  }

  @Get(':id')
  findOne(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.service.findOne(userId, id, {
      includeKnowledgeObjects: true,
    });
  }

  @Patch(':id')
  @UseInterceptors(FileFieldsInterceptor(PROFILE_FIELDS, PROFILE_UPLOAD_OPTIONS))
  update(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCognitiveAgentDto,
    @UploadedFiles() files: CognitiveProfileUploadFiles = {},
  ) {
    return this.service.update(userId, id, dto, {
      avatarFile: files.avatarFile?.[0] ?? null,
      coverFile: files.coverFile?.[0] ?? null,
    });
  }

  @Post(':id/restore')
  restore(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.service.restore(userId, id);
  }

  @Post(':id/test')
  test(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: TestCognitiveAgentDto,
  ) {
    return this.service.test(userId, id, dto);
  }

  @Post(':id/validate')
  validate(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.service.validateForPublish(userId, id);
  }

  @Post(':id/knowledge/upload')
  @UseInterceptors(
    FileFieldsInterceptor(
      KNOWLEDGE_FIELDS,
      KNOWLEDGE_UPLOAD_OPTIONS,
    ),
  )
  uploadKnowledge(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UploadCognitiveAgentKnowledgeDto,
    @UploadedFiles() files: CognitiveKnowledgeUploadFiles = {},
  ) {
    return this.service.uploadKnowledge(userId, id, dto, {
      knowledgeObjects: files.knowledgeObjects ?? [],
    });
  }

  @Get(':id/knowledge')
  knowledge(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.service.listKnowledge(userId, id);
  }

  @Delete(':id/knowledge/:objectId')
  deleteKnowledge(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Param('objectId') objectId: string,
  ) {
    return this.service.deleteKnowledge(userId, id, objectId);
  }

  @Post(':id/knowledge/reparse')
  reparseKnowledge(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.service.reparseKnowledge(userId, id);
  }

  @Delete(':id/permanent')
  permanentlyDelete(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ): Promise<CognitiveAgentPurgeResult> {
    return this.purge.permanentlyDeleteOwned(
      userId,
      id,
    );
  }

  @Delete(':id')
  remove(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.service.softDelete(userId, id);
  }


}
