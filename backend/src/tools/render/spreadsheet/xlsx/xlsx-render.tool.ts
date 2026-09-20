import { Injectable } from '@nestjs/common';
import type {
  RenderArtifact,
  RenderRequest,
  RenderTool,
  RenderToolDescriptor,
} from '../../render.types';
import { RenderPlanningError } from '../../planning/core/render-planning.errors';
import type { SpreadsheetRenderPlan } from '../../planning/spreadsheet/spreadsheet-render-plan.types';
import { SpreadsheetRenderPlanValidator } from '../../planning/spreadsheet/spreadsheet-render-plan.validator';
import { XlsxExecutionValidator } from './xlsx-execution.validator';
import { XlsxMaterializationMapper } from './xlsx-materialization.mapper';
import { XlsxRenderService } from './xlsx-render.service';

@Injectable()
export class XlsxRenderTool implements RenderTool<SpreadsheetRenderPlan> {
  readonly descriptor: RenderToolDescriptor = {
    name: 'spreadsheet.render.xlsx',
    version: '4.0.0',
    category: 'spreadsheet',
    enabled: true,
    description:
      'Materialize a validated canonical SpreadsheetRenderPlan into an XLSX workbook.',
    outputMimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    outputExtension: 'xlsx',
  };

  constructor(
    private readonly planValidator: SpreadsheetRenderPlanValidator,
    private readonly executionValidator: XlsxExecutionValidator,
    private readonly mapper: XlsxMaterializationMapper,
    private readonly service: XlsxRenderService,
  ) {}

  canHandle(request: RenderRequest): boolean {
    return request.toolName === this.descriptor.name;
  }

  async render(
    request: RenderRequest<SpreadsheetRenderPlan>,
  ): Promise<RenderArtifact> {
    const validated = this.planValidator.validate(request.payload);
    if (!validated.ok) {
      throw new RenderPlanningError(
        'SPREADSHEET_RENDER_PLAN_INVALID',
        'XLSX renderer accepts only a canonical SpreadsheetRenderPlan.',
        'validation',
        validated.diagnostics,
        false,
      );
    }

    const execution = this.executionValidator.validate(validated.value);
    if (!execution.ok) {
      throw new RenderPlanningError(
        'XLSX_EXECUTION_CONSTRAINT_FAILED',
        'Spreadsheet plan violates XLSX execution constraints.',
        'validation',
        execution.diagnostics,
        false,
      );
    }

    const runtime = this.mapper.materialize(execution.value);
    return this.service.render({
      ...request,
      payload: runtime,
    });
  }
}
