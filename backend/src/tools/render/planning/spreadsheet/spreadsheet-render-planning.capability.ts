import { Injectable } from '@nestjs/common';
import type { ToolContext } from '../../../toolstypes';
import { success, failure } from '../core/render-plan-diagnostics.types';
import { safeFilename } from '../core/render-plan.util';
import { SpreadsheetRenderOutputVerifier } from '../../verification/spreadsheet/spreadsheet-render-output.verifier';
import { XlsxExecutionValidator } from '../../spreadsheet/xlsx/xlsx-execution.validator';
import type {
  RenderOutputVerificationInput,
  RenderPlanningCapability,
} from '../core/render-planning-capability';
import type { RenderPlanningRequest } from '../core/render-plan.types';
import { SPREADSHEET_RENDER_PLAN_SCHEMA } from './spreadsheet-render-plan.schema';
import { SpreadsheetRenderPlanNormalizer } from './spreadsheet-render-plan.normalizer';
import type { SpreadsheetRenderPlan } from './spreadsheet-render-plan.types';
import { SpreadsheetRenderPlanValidator } from './spreadsheet-render-plan.validator';
import { SpreadsheetRenderPlannerService } from './spreadsheet-render-planner.service';

@Injectable()
export class SpreadsheetRenderPlanningCapability
  implements RenderPlanningCapability<SpreadsheetRenderPlan>
{
  readonly kind = 'spreadsheet' as const;
  readonly formats = ['xlsx'] as const;
  readonly schema = SPREADSHEET_RENDER_PLAN_SCHEMA;

  constructor(
    private readonly planner: SpreadsheetRenderPlannerService,
    private readonly normalizer: SpreadsheetRenderPlanNormalizer,
    private readonly validator: SpreadsheetRenderPlanValidator,
    private readonly executionValidator: XlsxExecutionValidator,
    private readonly verifier: SpreadsheetRenderOutputVerifier,
  ) {}

  plan(request: RenderPlanningRequest, context: ToolContext): Promise<unknown> {
    return this.planner.plan(request, context);
  }

  normalize(plan: unknown) {
    return this.normalizer.normalize(plan);
  }

  validate(plan: unknown) {
    return this.validator.validate(plan);
  }

  validateExecution(plan: SpreadsheetRenderPlan) {
    return this.executionValidator.validate(plan);
  }

  compile(plan: SpreadsheetRenderPlan, request: RenderPlanningRequest) {
    if (plan.output.format !== request.output.format) {
      return failure([{
        stage: 'compilation',
        code: 'SPREADSHEET_PLAN_OUTPUT_FORMAT_MISMATCH',
        message: `Plan output format ${plan.output.format} does not match requested format ${request.output.format}.`,
        path: '$.output.format',
        severity: 'error',
        repairable: true,
      }]);
    }

    return success({
      toolName: 'spreadsheet.render.xlsx' as const,
      payload: plan,
      filename: safeFilename(
        request.output.filename ?? plan.output.filename,
        plan.workbook.title || 'workbook',
        'xlsx',
      ),
    });
  }

  verifyOutput(input: RenderOutputVerificationInput<SpreadsheetRenderPlan>) {
    return this.verifier.verify(input);
  }
}
