import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../toolstypes';
import { RenderPipelineService } from '../render-pipeline.service';
import { RenderPlanningToolRequestFactory, renderPlanningToolInputSchema } from './render-planning-tool-request.factory';

@Injectable()
export class DocumentRenderPdfRuntimeTool implements Tool {
  name = 'document.render.pdf';
  version = '2.0.0';
  description = 'Plan, generate, verify, and persist a PDF document from a complete instruction and grounded source material.';
  tags = ['render', 'planning', 'document', 'pdf', 'artifact'];
  timeoutMs = 180_000;
  inputSchema = renderPlanningToolInputSchema('pdf');

  constructor(
    private readonly pipeline: RenderPipelineService,
    private readonly requests: RenderPlanningToolRequestFactory,
  ) {}

  validateArgs(args: Dict): void { this.requests.validate(args); }
  async canExecute(ctx: ToolContext): Promise<boolean> { return Boolean(ctx?.userId); }
  execute(args: Dict, ctx: ToolContext) {
    return this.pipeline.execute(this.requests.build('document', 'pdf', args), ctx);
  }
}
