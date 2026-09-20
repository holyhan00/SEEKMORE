import { Injectable } from '@nestjs/common';
import type { ToolContext } from '../../../toolstypes';
import { RenderPlanningModelService } from '../core/render-planning-model.service';
import type { RenderPlanningRequest } from '../core/render-plan.types';
import { serializeForPrompt } from '../core/render-plan.util';
import { SPREADSHEET_RENDER_PLAN_SCHEMA } from './spreadsheet-render-plan.schema';

@Injectable()
export class SpreadsheetRenderPlannerService {
  constructor(private readonly model: RenderPlanningModelService) {}

  async plan(request: RenderPlanningRequest, context: ToolContext): Promise<string> {
    const systemPrompt = [
      'You are a general spreadsheet render planner.',
      'Produce one canonical SpreadsheetRenderPlan that follows the supplied JSON Schema exactly.',
      'Infer workbook structure, sheet boundaries, block order, tables, matrices, columns, rows, summary rows, formulas, notes, hyperlinks, merges, freeze panes, page settings, and visual hierarchy from the complete instruction and source data.',
      'For structured tables, columns must be explicit and rows/summaryRows must always be arrays of row objects. For matrix tables, matrix must always be a two-dimensional array; its first row is the table header when showHeader is not false.',
      'Cell objects may explicitly define kind, value, text, formula, cachedResult, type, style, note, hyperlink, colSpan, rowSpan, width, and height. Legacy result is accepted but cachedResult is canonical.',
      'A formula cell should use kind formula, must define formula, and may define cachedResult, style, note, spans, width, or height, but it must not also define value, text, or hyperlink. cachedResult is a display cache, not proof that the formula was recalculated.',
      'When formulas use Excel structured references such as [@[Column]] or TableName[Column], the structured table must define a valid unique table.name, explicit columns, rows, and showHeader true so a real Excel table can be created.',
      'Do not use keyword routing and do not apply a fixed workbook template.',
      'Preserve every supplied value and relationship. Never fabricate missing source data.',
      'Use formulas only when their references are present and executable in the planned workbook. table.merges use A1 ranges relative to the final materialized table block, including optional title, header, and caption rows.',
      'Explicitly decide visible workbook behaviors supported by the schema. Do not invent fields outside the schema.',
      'Return exactly one JSON object with no markdown fences, commentary, or implementation code.',
    ].join('\n');

    return this.model.generate({
      systemPrompt,
      userPrompt: serializeForPrompt({
        request,
        schema: SPREADSHEET_RENDER_PLAN_SCHEMA,
      }),
      context,
      temperature: 0.2,
    });
  }
}
