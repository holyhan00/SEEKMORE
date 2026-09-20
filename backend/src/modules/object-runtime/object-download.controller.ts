import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RuntimeObject } from '@prisma/client';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RuntimeObjectService } from './object/object.service';
import { RuntimeObjectPreviewService } from './preview/object-preview.service';
import type { RuntimeObjectPreviewManifest } from './preview/object-preview.types';

@Controller('objects')
@UseGuards(JwtGuard)
export class RuntimeObjectDownloadController {
  private readonly logger = new Logger(RuntimeObjectDownloadController.name);

  constructor(
    private readonly objects: RuntimeObjectService,
    private readonly previews: RuntimeObjectPreviewService,
  ) {}

  @Get(':objectId/download')
  async download(
    @CurrentUserId() userId: string,
    @Param('objectId') objectId: string,
    @Res() res: Response,
  ): Promise<void> {
    const object = await this.objects.inspectOwned(userId, objectId);
    await this.verifyStoredObject(object);

    res.setHeader('Content-Type', object.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      this.contentDisposition(this.downloadFilename(object.displayName), 'attachment'),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(object.sizeBytes));

    await this.pipeObject(object, res);
  }

  @Get(':objectId/preview-manifest')
  async previewManifest(
    @CurrentUserId() userId: string,
    @Param('objectId') objectId: string,
  ): Promise<{ code: 0; message: 'success'; data: RuntimeObjectPreviewManifest }> {
    return {
      code: 0,
      message: 'success',
      data: await this.previews.manifest(userId, objectId),
    };
  }

  @Get(':objectId/preview')
  async preview(
    @CurrentUserId() userId: string,
    @Req() req: Request,
    @Param('objectId') objectId: string,
    @Query('v') version: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.previews.source(userId, objectId);
    const expectedVersion = String(source.contentHash).trim();
    const requestedVersion = String(version ?? '').trim();
    if (requestedVersion && requestedVersion !== expectedVersion) {
      throw new NotFoundException('OBJECT_PREVIEW_VERSION_NOT_FOUND');
    }

    const etag = `"${source.contentHash}"`;
    const ifNoneMatch = this.header(req, 'if-none-match');
    if (this.etagMatches(ifNoneMatch, etag)) {
      res.status(304).end();
      return;
    }

    res.setHeader('Content-Type', source.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', this.contentDisposition(source.displayName, 'inline'));
    res.setHeader('Cache-Control', requestedVersion
      ? 'private, max-age=31536000, immutable'
      : 'private, max-age=3600, must-revalidate');
    res.setHeader('ETag', etag);
    res.setHeader('Vary', 'Authorization, Cookie');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(source.sizeBytes));

    if (source.kind === 'html') {
      res.setHeader(
        'Content-Security-Policy',
        "sandbox allow-scripts allow-forms; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none';",
      );
      res.setHeader('Referrer-Policy', 'no-referrer');
    }

    if (source.kind === 'document' || source.kind === 'presentation') {
      res.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none';",
      );
      res.setHeader('Referrer-Policy', 'no-referrer');
    }

    await this.pipePreview(source, res);
  }

  private async verifyStoredObject(object: RuntimeObject): Promise<void> {
    await this.objects.assertStoredSize(object).catch((error) => {
      this.logger.error(
        `Object storage verification failed objectId=${object.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('OBJECT_STORAGE_UNAVAILABLE');
    });
  }

  private async pipeObject(object: RuntimeObject, res: Response): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const stream = this.objects.createReadStream(object);
      stream.on('error', (error) => {
        if (!res.headersSent) {
          reject(new InternalServerErrorException('OBJECT_STORAGE_READ_FAILED'));
          return;
        }
        res.destroy(error);
        reject(error);
      });
      res.on('finish', resolve);
      res.on('close', resolve);
      stream.pipe(res);
    });
  }

  private async pipePreview(
    source: Awaited<ReturnType<RuntimeObjectPreviewService['source']>>,
    res: Response,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const stream = this.previews.createReadStream(source);
      stream.on('error', (error) => {
        if (!res.headersSent) {
          reject(new InternalServerErrorException('OBJECT_STORAGE_READ_FAILED'));
          return;
        }
        res.destroy(error);
        reject(error);
      });
      res.on('finish', resolve);
      res.on('close', resolve);
      stream.pipe(res);
    });
  }



  private header(req: Request, name: string): string {
    const value = req.headers?.[name];
    return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
  }


  private etagMatches(header: string, etag: string): boolean {
    const values = String(header ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return values.includes('*')
      || values.includes(etag)
      || values.includes(`W/${etag}`);
  }


  private downloadFilename(filename: string): string {
    const normalized = String(filename || 'download').trim() || 'download';
    return /^seekmore-/i.test(normalized)
      ? `Seekmore-${normalized.replace(/^seekmore-/i, '')}`
      : `Seekmore-${normalized}`;
  }

  private contentDisposition(filename: string, mode: 'inline' | 'attachment'): string {
    const fallback = String(filename || 'download')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .slice(0, 180) || 'download';
    return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename || 'download')}`;
  }
}
