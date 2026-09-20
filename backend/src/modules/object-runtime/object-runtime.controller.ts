import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ObjectCardMapper } from './object/object-card.mapper';
import { RuntimeObjectService } from './object/object.service';
import { ObjectPartitionDto, ObjectSearchDto } from './object-query.dto';
import { ObjectUploadDto } from './object-upload.dto';
const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const configuredUploadBytes = Number(process.env.OBJECT_CATALOG_MAX_UPLOAD_BYTES ?? DEFAULT_MAX_UPLOAD_BYTES);
const MAX_UPLOAD_BYTES = Number.isFinite(configuredUploadBytes) && configuredUploadBytes > 0
  ? Math.floor(configuredUploadBytes)
  : DEFAULT_MAX_UPLOAD_BYTES;

@Controller('objects')
@UseGuards(JwtGuard)
export class ObjectRuntimeController {
  constructor(
    private readonly objects: RuntimeObjectService,
    private readonly cards: ObjectCardMapper,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('object', {
    limits: {
      files: 1,
      fields: 4,
      fileSize: MAX_UPLOAD_BYTES,
      fieldSize: 4096,
      parts: 6,
    },
  }))
  async upload(
    @CurrentUserId() userId: string,
    @UploadedFile() uploadedFile: Express.Multer.File,
    @Body() body: ObjectUploadDto,
  ) {
    if (!uploadedFile?.buffer?.length) throw new BadRequestException('OBJECT_FILE_REQUIRED');

    const object = await this.objects.upload({
      userId,
      agentId: body.agentId,
      conversationId: body.conversationId,
      object: uploadedFile,
    });

    return { code: 0, message: 'success', data: this.cards.toDto(object) };
  }

  @Get()
  async search(@CurrentUserId() userId: string, @Query() query: ObjectSearchDto) {
    const result = await this.objects.search({
      userId,
      agentId: query.agentId,
      conversationId: query.conversationId,
      query: query.query,
      objectKind: query.objectKind,
      originType: query.originType,
      extension: query.extension,
      cursor: query.cursor,
      limit: this.limit(query.limit),
    });
    return { code: 0, message: 'success', data: result };
  }

  @Get(':objectId')
  async inspect(
    @CurrentUserId() userId: string,
    @Param('objectId') objectId: string,
    @Query() query: ObjectPartitionDto,
  ) {
    const data = await this.objects.inspectCard({
      userId,
      agentId: query.agentId,
      conversationId: query.conversationId,
    }, objectId);
    return { code: 0, message: 'success', data };
  }



  private limit(value?: string): number {
    const parsed = Number(value ?? 20);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), 50)) : 20;
  }
}
