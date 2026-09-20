import { Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../toolstypes';
import { RenderPipelineService } from '../render-pipeline.service';
import { RenderPlanningToolRequestFactory, renderPlanningToolInputSchema } from './render-planning-tool-request.factory';

@Injectable()
export class SpreadsheetRenderXlsxRuntimeTool implements Tool {
  name = 'spreadsheet.render.xlsx';
  version = '4.0.0';
  description = 'Plan, generate, verify, and persist an XLSX workbook from a complete instruction and grounded source data.';
  tags = ['render', 'planning', 'spreadsheet', 'xlsx', 'artifact'];
  timeoutMs = 180_000;
  inputSchema = renderPlanningToolInputSchema('xlsx');

  constructor(
    private readonly pipeline: RenderPipelineService,
    private readonly requests: RenderPlanningToolRequestFactory,
  ) {}

  validateArgs(args: Dict): void { this.requests.validate(args); }
  async canExecute(ctx: ToolContext): Promise<boolean> { return Boolean(ctx?.userId); }
  execute(args: Dict, ctx: ToolContext) {
    return this.pipeline.execute(this.requests.build('spreadsheet', 'xlsx', args), ctx);
  }
}
