                                                                 

import { Injectable } from '@nestjs/common';
import { RenderArtifact, RenderRequest, RenderTool, RenderToolDescriptor } from '../../render.types';
import { PptxRenderService } from './pptx-render.service';

@Injectable()
export class PptxRenderTool implements RenderTool {
  readonly descriptor: RenderToolDescriptor = {
    name: 'presentation.pptx.write',
    version: '4.0.0',
    category: 'presentation',
    enabled: true,
    description: 'Deterministic PPTX writer for resolved editable presentation text, shape, line, image, and fill geometry.',
    outputMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    outputExtension: 'pptx',
  };

  constructor(private readonly service: PptxRenderService) {}

  canHandle(request: RenderRequest): boolean {
    return request.toolName === this.descriptor.name;
  }

  render(request: RenderRequest): Promise<RenderArtifact> {
    return this.service.render(request);
  }
}
