import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUserId } from '../../../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../../../common/guards/jwt.guard';
import { SKILL_PACKAGE_LIMITS } from '../domain/skill-policy';
import { SkillImportService } from '../import/skill-import.service';
import { CommitSkillImportDto, InspectSkillImportDto } from './dto/skill-import.dto';
import { SkillApiSerializationInterceptor } from './interceptors/skill-api-serialization.interceptor';


const uploadOptions = {
  storage: memoryStorage(),
  limits: {
    files: 1,
    fileSize: SKILL_PACKAGE_LIMITS.maxArchiveUploadBytes,
    fields: 8,
    fieldSize: 2 * 1024 * 1024,
  },
};

@Controller('skills/import')
@UseGuards(JwtGuard)
@UseInterceptors(SkillApiSerializationInterceptor)
export class SkillImportController {
  constructor(private readonly imports: SkillImportService) {}

  @Post('inspect')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  inspect(
    @CurrentUserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: InspectSkillImportDto,
  ) {
    return this.imports.inspect({
      userId: userId,
      file: file ?? null,
      repositoryUrl: dto.repositoryUrl?.trim() || null,
      content: dto.content ?? null,
    });
  }

  @Post('commit')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  commit(
    @CurrentUserId() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CommitSkillImportDto,
  ) {
    return this.imports.commit({
      userId: userId,
      packageChecksum: dto.packageChecksum,
      file: file ?? null,
      repositoryUrl: dto.repositoryUrl?.trim() || null,
      content: dto.content ?? null,
    });
  }

}
