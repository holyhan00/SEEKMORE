                                                          

import { Injectable } from '@nestjs/common';
import { RenderArtifact, RenderRequest, RenderTool, RenderToolDescriptor } from '../../render.types';
import { ZipRenderService } from './zip-render.service';

@Injectable()
export class ZipRenderTool implements RenderTool {
  readonly descriptor: RenderToolDescriptor = {
    name: 'package.render.zip',
    version: '1.0.0',
    category: 'package',
    enabled: true,
    description: 'Persisted ZIP package renderer for generated file manifests.',
    outputMimeType: 'application/zip',
    outputExtension: 'zip',
  };

  constructor(private readonly service: ZipRenderService) {}

  canHandle(request: RenderRequest): boolean {
    return request.toolName === this.descriptor.name;
  }

  render(request: RenderRequest): Promise<RenderArtifact> {
    return this.service.render(request);
  }
}
