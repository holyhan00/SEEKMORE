import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SkillFileType } from '@prisma/client';
import { CurrentUserId } from '../../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../../common/guards/jwt.guard';
import { SkillApiSerializationInterceptor } from './interceptors/skill-api-serialization.interceptor';
import { SkillFileService } from '../files/skill-file.service';
import { SkillDependencyService } from '../application/skill-dependency.service';
import {
  DeleteSkillFilesDto,
  ReplaceSkillDependenciesDto,
  ReplaceSkillSchemasDto,
  type SkillFileMetadataDto,
} from './dto/skill.dto';
import { SkillSchemaService } from '../application/skill-schema.service';
import { SKILL_PACKAGE_LIMITS } from '../domain/skill-policy';


const MAX_FILE_BYTES = Math.max(
  SKILL_PACKAGE_LIMITS.maxReferenceBytes,
  SKILL_PACKAGE_LIMITS.maxScriptBytes,
  SKILL_PACKAGE_LIMITS.maxAssetBytes,
);

@Controller('skills/:skillId/versions/:versionId')
@UseGuards(JwtGuard)
@UseInterceptors(SkillApiSerializationInterceptor)
export class SkillFileController {
  constructor(
    private readonly files: SkillFileService,
    private readonly dependencies: SkillDependencyService,
    private readonly schemas: SkillSchemaService,
  ) {}

  @Get('files')
  list(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.files.list(
      userId,
      skillId,
      versionId,
    );
  }

  @Post('files/batch')
  @UseInterceptors(
    FilesInterceptor(
      'files',
      SKILL_PACKAGE_LIMITS.maxFiles,
      {
        storage: memoryStorage(),
        limits: {
          files: SKILL_PACKAGE_LIMITS.maxFiles,
          fileSize: MAX_FILE_BYTES,
          fields: 2,
        },
      },
    ),
  )
  uploadMany(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('entries') rawEntries: string,
  ) {
    if (!files?.length) {
      throw new BadRequestException(
        'SKILL_FILES_REQUIRED',
      );
    }

    const entries = this.parseEntries(
      rawEntries,
      files,
    );

    return this.files.uploadMany(
      userId,
      skillId,
      versionId,
      files.map((file, index) => ({
        file,
        rawPath:
          entries[index].path ||
          file.originalname,
        requestedType:
          entries[index].fileType,
      })),
    );
  }

  @Post('files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        files: 1,
        fileSize: MAX_FILE_BYTES,
        fields: 4,
      },
    }),
  )
  upload(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('path') path: string,
    @Body('fileType') fileType?: SkillFileType,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'SKILL_FILE_REQUIRED',
      );
    }

    return this.files.upload(
      userId,
      skillId,
      versionId,
      file,
      path || file.originalname,
      fileType,
    );
  }

  @Delete('files/batch')
  removeMany(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
    @Body() dto: DeleteSkillFilesDto,
  ) {
    return this.files.removeMany(
      userId,
      skillId,
      versionId,
      dto.fileIds,
    );
  }

  @Delete('files/:fileId')
  remove(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.remove(
      userId,
      skillId,
      versionId,
      fileId,
    );
  }

  @Get('dependencies')
  dependencyList(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.dependencies.get(
      userId,
      skillId,
      versionId,
    );
  }

  @Put('dependencies')
  dependencyReplace(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
    @Body() dto: ReplaceSkillDependenciesDto,
  ) {
    return this.dependencies.replace(
      userId,
      skillId,
      versionId,
      dto,
    );
  }

  @Get('schemas')
  schemaList(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.schemas.get(
      userId,
      skillId,
      versionId,
    );
  }

  @Put('schemas')
  schemaReplace(
    @CurrentUserId() userId: string,
    @Param('skillId') skillId: string,
    @Param('versionId') versionId: string,
    @Body() dto: ReplaceSkillSchemasDto,
  ) {
    return this.schemas.replace(
      userId,
      skillId,
      versionId,
      dto,
    );
  }

  private parseEntries(
    rawEntries: string,
    files: Express.Multer.File[],
  ): SkillFileMetadataDto[] {
    let parsed: unknown;

    try {
      parsed = JSON.parse(
        String(rawEntries ?? ''),
      );
    } catch {
      throw new BadRequestException(
        'SKILL_FILE_BATCH_METADATA_INVALID',
      );
    }

    if (
      !Array.isArray(parsed) ||
      parsed.length !== files.length
    ) {
      throw new BadRequestException(
        'SKILL_FILE_BATCH_METADATA_MISMATCH',
      );
    }

    const allowedTypes = new Set<string>(
      Object.values(SkillFileType),
    );

    return parsed.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        throw new BadRequestException(
          'SKILL_FILE_BATCH_ENTRY_INVALID',
        );
      }

      const entry = value as {
        path?: unknown;
        fileType?: unknown;
      };

      const path = String(
        entry.path ?? '',
      ).trim();

      if (!path || path.length > 500) {
        throw new BadRequestException(
          'SKILL_FILE_BATCH_PATH_INVALID',
        );
      }

      if (
        entry.fileType !== undefined &&
        !allowedTypes.has(
          String(entry.fileType),
        )
      ) {
        throw new BadRequestException(
          'SKILL_FILE_BATCH_TYPE_INVALID',
        );
      }

      return {
        path,
        fileType:
          entry.fileType === undefined
            ? undefined
            : (String(
                entry.fileType,
              ) as SkillFileType),
      };
    });
  }

}
