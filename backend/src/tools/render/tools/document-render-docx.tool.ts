import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../toolstypes';
import { RenderPipelineService } from '../render-pipeline.service';
import { RenderPlanningToolRequestFactory, renderPlanningToolInputSchema } from './render-planning-tool-request.factory';

@Injectable()
export class DocumentRenderDocxRuntimeTool implements Tool {
  name = 'document.render.docx';
  version = '4.0.0';
  description = 'Plan, generate, verify, and persist a formatted DOCX document from a complete instruction and grounded source material.';
  tags = ['render', 'planning', 'document', 'docx', 'artifact'];
  timeoutMs = 180_000;
  inputSchema = renderPlanningToolInputSchema('docx');

  constructor(
    private readonly pipeline: RenderPipelineService,
    private readonly requests: RenderPlanningToolRequestFactory,
  ) {}

  validateArgs(args: Dict): void { this.requests.validate(args); }
  async canExecute(ctx: ToolContext): Promise<boolean> { return Boolean(ctx?.userId); }
  execute(args: Dict, ctx: ToolContext) {
    return this.pipeline.execute(this.requests.build('document', 'docx', args), ctx);
  }
}
