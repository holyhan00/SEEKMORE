                                                             

import { Injectable } from '@nestjs/common';
import {
  RenderArtifact,
  RenderRequest,
  RenderTool,
  RenderToolDescriptor,
} from '../../render.types';
import { DocxRenderService } from './docx-render.service';
import { DocxRenderPayload } from './docx-render.types';

@Injectable()
export class DocxRenderTool
  implements RenderTool<DocxRenderPayload>
{
  readonly descriptor: RenderToolDescriptor = {
    name: 'document.render.docx',
    version: '3.0.0',
    category: 'document',
    enabled: true,
    description:
      'Render production-grade DOCX documents from structured blocks, markdown, tables, images, and plain text.',
    outputMimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    outputExtension: 'docx',
  };

  constructor(private readonly service: DocxRenderService) {}

  canHandle(request: RenderRequest): boolean {
    return request.toolName === this.descriptor.name;
  }

  render(
    request: RenderRequest<DocxRenderPayload>,
  ): Promise<RenderArtifact> {
    return this.service.render(request);
  }
}