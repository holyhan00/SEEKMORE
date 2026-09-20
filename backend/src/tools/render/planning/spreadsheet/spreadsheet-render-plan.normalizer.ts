import { Injectable } from '@nestjs/common';
import {
  success,
  type RenderPlanDiagnostic,
  type RenderStageResult,
} from '../core/render-plan-diagnostics.types';
import { isRecord } from '../core/render-plan.util';

const COLOR_FIELDS = [
  'primaryColor',
  'accentColor',
  'headerFill',
  'textColor',
  'mutedColor',
  'borderColor',
  'summaryFill',
  'zebraFill',
] as const;

@Injectable()
export class SpreadsheetRenderPlanNormalizer {
  normalize(input: unknown): RenderStageResult<unknown> {
    if (!isRecord(input)) return success(input);

    const normalized = this.clone(input);
    const diagnostics: RenderPlanDiagnostic[] = [];
    const workbook = isRecord(normalized.workbook) ? normalized.workbook : undefined;
    const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];

    sheets.forEach((sheet, sheetIndex) => {
      if (!isRecord(sheet)) return;
      if (typeof sheet.name === 'string') sheet.name = sheet.name.trim();
      const blocks = Array.isArray(sheet.blocks) ? sheet.blocks : [];
      blocks.forEach((block, blockIndex) => {
        if (!isRecord(block) || block.type !== 'table' || !isRecord(block.table)) return;
        this.normalizeRowCollection(
          block.table,
          'rows',
          `$.workbook.sheets[${sheetIndex}].blocks[${blockIndex}].table.rows`,
          diagnostics,
        );
        this.normalizeRowCollection(
          block.table,
          'summaryRows',
          `$.workbook.sheets[${sheetIndex}].blocks[${blockIndex}].table.summaryRows`,
          diagnostics,
        );
      });
    });

    const design = isRecord(normalized.design) ? normalized.design : undefined;
    if (design) {
      for (const field of COLOR_FIELDS) {
        const value = design[field];
        if (typeof value !== 'string') continue;
        const clean = value.trim().replace(/^#/, '').toUpperCase();
        if (clean !== value) {
          design[field] = clean;
          diagnostics.push({
            stage: 'validation',
            code: 'SPREADSHEET_PLAN_COLOR_NORMALIZED',
            message: `${field} was normalized to an uppercase hex value without '#'.`,
            path: `$.design.${field}`,
            severity: 'info',
            repairable: false,
          });
        }
      }
    }

    return success(normalized, diagnostics);
  }

  private normalizeRowCollection(
    table: Record<string, unknown>,
    key: 'rows' | 'summaryRows',
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const value = table[key];
    if (!isRecord(value)) return;
    table[key] = [value];
    diagnostics.push({
      stage: 'validation',
      code: key === 'rows'
        ? 'SPREADSHEET_PLAN_ROWS_NORMALIZED'
        : 'SPREADSHEET_PLAN_SUMMARY_ROWS_NORMALIZED',
      message: `${key} was normalized from one row object to an array.`,
      path,
      severity: 'warning',
      repairable: false,
    });
  }

  private clone<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((entry) => this.clone(entry)) as T;
    }
    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, this.clone(entry)]),
      ) as T;
    }
    return value;
  }
}
