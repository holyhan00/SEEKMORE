                                                           

import { Injectable } from '@nestjs/common';
import { RenderArtifact, RenderRequest, RenderTool, RenderToolDescriptor } from '../../render.types';
import { PdfRenderService } from './pdf-render.service';

@Injectable()
export class PdfRenderTool implements RenderTool {
  readonly descriptor: RenderToolDescriptor = {
    name: 'document.render.pdf',
    version: '1.0.0',
    category: 'document',
    enabled: true,
    description: 'Basic persisted PDF renderer for structured document payloads.',
    outputMimeType: 'application/pdf',
    outputExtension: 'pdf',
  };

  constructor(private readonly service: PdfRenderService) {}

  canHandle(request: RenderRequest): boolean {
    return request.toolName === this.descriptor.name;
  }

  render(request: RenderRequest): Promise<RenderArtifact> {
    return this.service.render(request);
  }
}
