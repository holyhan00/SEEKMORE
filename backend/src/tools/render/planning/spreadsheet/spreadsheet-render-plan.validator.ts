import { Injectable } from '@nestjs/common';
import {
  failure,
  success,
  type RenderPlanDiagnostic,
  type RenderStageResult,
} from '../core/render-plan-diagnostics.types';
import { isRecord, nonEmptyString } from '../core/render-plan.util';
import { SPREADSHEET_RENDER_PLAN_SCHEMA } from './spreadsheet-render-plan.schema';
import {
  SPREADSHEET_PLAN_BORDER_STYLES,
  SPREADSHEET_PLAN_HORIZONTAL_ALIGNMENTS,
  SPREADSHEET_PLAN_PAPER_SIZES,
  SPREADSHEET_PLAN_VERTICAL_ALIGNMENTS,
  SPREADSHEET_RENDER_PLAN_BLOCK_TYPES,
  SPREADSHEET_RENDER_PLAN_VALUE_TYPES,
  type SpreadsheetRenderPlan,
} from './spreadsheet-render-plan.types';

@Injectable()
export class SpreadsheetRenderPlanValidator {
  private readonly maxSheets = 100;
  private readonly maxBlocksPerSheet = 500;
  private readonly maxRowsPerTable = 100_000;
  private readonly maxColumnsPerTable = 300;

  validate(input: unknown): RenderStageResult<SpreadsheetRenderPlan> {
    const diagnostics: RenderPlanDiagnostic[] = [];
    if (!isRecord(input)) {
      return failure([
        this.error(
          'SPREADSHEET_PLAN_ROOT_INVALID',
          'Spreadsheet render plan must be an object.',
          '$',
        ),
      ]);
    }

    this.validateKnownProperties(input, '$', diagnostics);

    if (input.version !== 'render-plan/v1') {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_VERSION_INVALID',
        'version must be render-plan/v1.',
        '$.version',
      ));
    }
    if (input.kind !== 'spreadsheet') {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_KIND_INVALID',
        'kind must be spreadsheet.',
        '$.kind',
      ));
    }

    this.validateObjective(input.objective, '$.objective', diagnostics);
    this.validateWorkbook(input.workbook, '$.workbook', diagnostics);
    this.validateDesign(input.design, '$.design', diagnostics);
    this.validateOutput(input.output, '$.output', diagnostics);
    this.validateRationale(input.rationale, '$.rationale', diagnostics);

    if (diagnostics.some((item) => item.severity === 'error')) {
      return failure(diagnostics);
    }
    return success(input as unknown as SpreadsheetRenderPlan, diagnostics);
  }

  private validateObjective(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!isRecord(input)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_OBJECTIVE_INVALID',
        'objective must be an object.',
        path,
      ));
      return;
    }
    this.validateKnownProperties(input, path, diagnostics, 'objective');
    if (!nonEmptyString(input.purpose)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_PURPOSE_REQUIRED',
        'objective.purpose is required.',
        `${path}.purpose`,
      ));
    }
    this.optionalStrings(input, ['audience', 'usage', 'language'], path, diagnostics);
  }

  private validateWorkbook(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!isRecord(input)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_WORKBOOK_INVALID',
        'workbook must be an object.',
        path,
      ));
      return;
    }
    this.validateKnownProperties(input, path, diagnostics, 'workbook');
    if (!nonEmptyString(input.title)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_TITLE_REQUIRED',
        'workbook.title is required.',
        `${path}.title`,
      ));
    }
    if (input.subtitle != null && typeof input.subtitle !== 'string') {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_SUBTITLE_INVALID',
        'workbook.subtitle must be a string.',
        `${path}.subtitle`,
      ));
    }
    if (!Array.isArray(input.sheets)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_SHEETS_ARRAY_REQUIRED',
        'workbook.sheets must be an array.',
        `${path}.sheets`,
      ));
      return;
    }
    if (input.sheets.length === 0) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_SHEETS_REQUIRED',
        'workbook.sheets must contain at least one sheet.',
        `${path}.sheets`,
      ));
      return;
    }
    if (input.sheets.length > this.maxSheets) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_SHEET_LIMIT',
        `workbook.sheets exceeds the maximum of ${this.maxSheets}.`,
        `${path}.sheets`,
        false,
      ));
    }

    const names = new Set<string>();
    input.sheets.forEach((sheet, index) => {
      const sheetPath = `${path}.sheets[${index}]`;
      if (!isRecord(sheet)) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_SHEET_INVALID',
          'Sheet must be an object.',
          sheetPath,
        ));
        return;
      }
      this.validateKnownProperties(sheet, sheetPath, diagnostics, 'sheet');
      const name = nonEmptyString(sheet.name);
      if (!name) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_SHEET_NAME_REQUIRED',
          'sheet.name is required.',
          `${sheetPath}.name`,
        ));
      } else if (names.has(name)) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_SHEET_NAME_DUPLICATE',
          `Duplicate sheet name: ${name}.`,
          `${sheetPath}.name`,
        ));
      } else {
        names.add(name);
      }

      this.optionalStrings(sheet, ['title', 'subtitle', 'purpose'], sheetPath, diagnostics);
      if (!Array.isArray(sheet.blocks)) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_BLOCKS_ARRAY_REQUIRED',
          'sheet.blocks must be an array.',
          `${sheetPath}.blocks`,
        ));
      } else if (sheet.blocks.length === 0) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_BLOCKS_REQUIRED',
          'sheet.blocks must contain at least one block.',
          `${sheetPath}.blocks`,
        ));
      } else {
        if (sheet.blocks.length > this.maxBlocksPerSheet) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_BLOCK_LIMIT',
            `sheet.blocks exceeds the maximum of ${this.maxBlocksPerSheet}.`,
            `${sheetPath}.blocks`,
            false,
          ));
        }
        sheet.blocks.forEach((block, blockIndex) => {
          diagnostics.push(...this.validateBlock(
            block,
            `${sheetPath}.blocks[${blockIndex}]`,
          ));
        });
      }
      if (sheet.freeze != null) {
        this.validateFreeze(sheet.freeze, `${sheetPath}.freeze`, diagnostics);
      }
      if (sheet.page != null) {
        this.validatePage(sheet.page, `${sheetPath}.page`, diagnostics);
      }
    });
  }

  private validateBlock(input: unknown, path: string): RenderPlanDiagnostic[] {
    if (!isRecord(input)) {
      return [this.error(
        'SPREADSHEET_PLAN_BLOCK_INVALID',
        'Block must be an object.',
        path,
      )];
    }
    const type = nonEmptyString(input.type);
    if (!type || !(SPREADSHEET_RENDER_PLAN_BLOCK_TYPES as readonly string[]).includes(type)) {
      return [this.error(
        'SPREADSHEET_PLAN_BLOCK_TYPE_INVALID',
        'Block type is not supported.',
        `${path}.type`,
      )];
    }

    const diagnostics: RenderPlanDiagnostic[] = [];
    const blockDefinition = type === 'text'
      ? 'textBlock'
      : type === 'matrix'
        ? 'matrixBlock'
        : type === 'spacer'
          ? 'spacerBlock'
          : 'tableBlock';
    this.validateKnownProperties(input, path, diagnostics, blockDefinition);
    if (type === 'text') {
      if (typeof input.value !== 'string') {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_TEXT_REQUIRED',
          'text block requires a string value.',
          `${path}.value`,
        ));
      }
      this.optionalPositiveNumber(input.mergeAcross, `${path}.mergeAcross`, diagnostics, true);
      this.optionalPositiveNumber(input.height, `${path}.height`, diagnostics);
      this.optionalNonNegativeInteger(input.spacingAfter, `${path}.spacingAfter`, diagnostics);
      if (input.style != null) this.validateStyle(input.style, `${path}.style`, diagnostics);
      return diagnostics;
    }

    if (type === 'matrix') {
      this.validateMatrix(input.matrix, `${path}.matrix`, diagnostics);
      if (input.merges != null) this.validateMerges(input.merges, `${path}.merges`, diagnostics);
      this.optionalPositiveNumber(input.startColumn, `${path}.startColumn`, diagnostics, true);
      if (input.style != null) this.validateStyle(input.style, `${path}.style`, diagnostics);
      return diagnostics;
    }

    if (type === 'spacer') {
      if (input.rows != null) {
        if (!Number.isInteger(input.rows) || Number(input.rows) < 1 || Number(input.rows) > 100) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_SPACER_ROWS_INVALID',
            'spacer.rows must be an integer between 1 and 100.',
            `${path}.rows`,
          ));
        }
      }
      return diagnostics;
    }

    if (!isRecord(input.table)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_TABLE_INVALID',
        'table block requires a table object.',
        `${path}.table`,
      ));
      return diagnostics;
    }
    this.optionalPositiveNumber(input.startColumn, `${path}.startColumn`, diagnostics, true);
    this.validateTable(input.table, `${path}.table`, diagnostics);
    return diagnostics;
  }

  private validateTable(
    table: Record<string, unknown>,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    this.validateKnownProperties(table, path, diagnostics, 'table');
    this.optionalStrings(table, ['name', 'title', 'caption', 'note'], path, diagnostics);

    const hasMatrixField = Object.prototype.hasOwnProperty.call(table, 'matrix');
    const hasRowsField = Object.prototype.hasOwnProperty.call(table, 'rows');
    const hasSummaryRowsField = Object.prototype.hasOwnProperty.call(table, 'summaryRows');
    const hasColumnsField = Object.prototype.hasOwnProperty.call(table, 'columns');

    if (hasColumnsField && !Array.isArray(table.columns)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_COLUMNS_ARRAY_REQUIRED',
        'table.columns must be an array.',
        `${path}.columns`,
      ));
    } else if (Array.isArray(table.columns)) {
      if (table.columns.length === 0) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_COLUMNS_REQUIRED',
          'table.columns must contain at least one column.',
          `${path}.columns`,
        ));
      }
      if (table.columns.length > this.maxColumnsPerTable) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_COLUMN_LIMIT',
          `table.columns exceeds the maximum of ${this.maxColumnsPerTable}.`,
          `${path}.columns`,
          false,
        ));
      }
      const keys = new Set<string>();
      table.columns.forEach((column, index) => {
        const columnPath = `${path}.columns[${index}]`;
        if (!isRecord(column)) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_INVALID',
            'Column must be an object.',
            columnPath,
          ));
          return;
        }
        this.validateKnownProperties(column, columnPath, diagnostics, 'column');
        const key = nonEmptyString(column.key);
        if (!key) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_KEY_REQUIRED',
            'column.key is required.',
            `${columnPath}.key`,
          ));
        } else if (keys.has(key)) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_KEY_DUPLICATE',
            `Duplicate column key: ${key}.`,
            `${columnPath}.key`,
          ));
        } else {
          keys.add(key);
        }
        if (typeof column.header !== 'string') {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_HEADER_REQUIRED',
            'column.header must be a string.',
            `${columnPath}.header`,
          ));
        }
        if (column.type != null && !(SPREADSHEET_RENDER_PLAN_VALUE_TYPES as readonly unknown[]).includes(column.type)) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_TYPE_INVALID',
            'column.type is not supported.',
            `${columnPath}.type`,
          ));
        }
        this.optionalPositiveNumber(column.width, `${columnPath}.width`, diagnostics);
        this.optionalPositiveNumber(column.minWidth, `${columnPath}.minWidth`, diagnostics);
        this.optionalPositiveNumber(column.maxWidth, `${columnPath}.maxWidth`, diagnostics);
        if (typeof column.minWidth === 'number' && typeof column.maxWidth === 'number' && column.minWidth > column.maxWidth) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_WIDTH_RANGE_INVALID',
            'column.minWidth must not exceed column.maxWidth.',
            columnPath,
          ));
        }
        if (
          typeof column.width === 'number' &&
          typeof column.minWidth === 'number' &&
          column.width < column.minWidth
        ) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_WIDTH_BELOW_MINIMUM',
            'column.width must not be smaller than column.minWidth.',
            `${columnPath}.width`,
          ));
        }
        if (
          typeof column.width === 'number' &&
          typeof column.maxWidth === 'number' &&
          column.width > column.maxWidth
        ) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_WIDTH_ABOVE_MAXIMUM',
            'column.width must not exceed column.maxWidth.',
            `${columnPath}.width`,
          ));
        }
        if (column.formula != null && !nonEmptyString(column.formula)) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_COLUMN_FORMULA_INVALID',
            'column.formula must be a non-empty string.',
            `${columnPath}.formula`,
          ));
        }
        for (const styleField of ['style', 'headerStyle', 'summaryStyle'] as const) {
          if (column[styleField] != null) {
            this.validateStyle(column[styleField], `${columnPath}.${styleField}`, diagnostics);
          }
        }
        this.optionalBoolean(column.hidden, `${columnPath}.hidden`, diagnostics);
      });
    }

    if (hasRowsField && !Array.isArray(table.rows)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_ROWS_ARRAY_REQUIRED',
        'table.rows must be an array.',
        `${path}.rows`,
      ));
    } else if (Array.isArray(table.rows)) {
      this.validateRows(table.rows, `${path}.rows`, diagnostics);
    }

    if (hasSummaryRowsField && !Array.isArray(table.summaryRows)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_SUMMARY_ROWS_ARRAY_REQUIRED',
        'table.summaryRows must be an array.',
        `${path}.summaryRows`,
      ));
    } else if (Array.isArray(table.summaryRows)) {
      this.validateRows(table.summaryRows, `${path}.summaryRows`, diagnostics);
    }

    if (hasMatrixField) {
      this.validateMatrix(table.matrix, `${path}.matrix`, diagnostics);
    }
    if (table.merges != null) this.validateMerges(table.merges, `${path}.merges`, diagnostics);

    const structuredRows = hasRowsField || hasSummaryRowsField;
    if (!hasMatrixField && !structuredRows) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_TABLE_DATA_REQUIRED',
        'table requires matrix or structured rows.',
        path,
      ));
    }
    if (structuredRows && !hasColumnsField) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_TABLE_COLUMNS_REQUIRED',
        'table.columns is required when rows or summaryRows are used.',
        `${path}.columns`,
      ));
    }
    if (hasMatrixField && structuredRows) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_TABLE_DATA_MODE_CONFLICT',
        'table must use either matrix or columns with rows, not both.',
        path,
      ));
    }

    for (const field of ['showHeader', 'autoFilter', 'freezeHeader', 'striped', 'compact', 'autoFit'] as const) {
      this.optionalBoolean(table[field], `${path}.${field}`, diagnostics);
    }
    if (table.styles != null) {
      if (!isRecord(table.styles)) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_TABLE_STYLES_INVALID',
          'table.styles must be an object.',
          `${path}.styles`,
        ));
      } else {
        this.validateKnownProperties(table.styles, `${path}.styles`, diagnostics, 'tableStyles');
        for (const field of ['title', 'header', 'body', 'summary', 'caption'] as const) {
          if (table.styles[field] != null) {
            this.validateStyle(table.styles[field], `${path}.styles.${field}`, diagnostics);
          }
        }
      }
    }
  }

  private validateRows(
    rows: unknown[],
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (rows.length > this.maxRowsPerTable) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_ROW_LIMIT',
        `Rows exceed the maximum of ${this.maxRowsPerTable}.`,
        path,
        false,
      ));
    }
    rows.forEach((row, rowIndex) => {
      if (!isRecord(row)) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_ROW_INVALID',
          'Each table row must be an object.',
          `${path}[${rowIndex}]`,
        ));
        return;
      }
      Object.entries(row).forEach(([key, value]) => {
        if (!key.trim()) {
          diagnostics.push(this.error(
            'SPREADSHEET_PLAN_ROW_KEY_INVALID',
            'Row keys must be non-empty strings.',
            `${path}[${rowIndex}]`,
          ));
        }
        this.validateCellLikeValue(value, `${path}[${rowIndex}].${key}`, diagnostics);
      });
    });
  }

  private validateMatrix(
    matrix: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!Array.isArray(matrix)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_MATRIX_ARRAY_REQUIRED',
        'matrix must be an array.',
        path,
      ));
      return;
    }
    if (matrix.length === 0) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_MATRIX_REQUIRED',
        'matrix must contain at least one row.',
        path,
      ));
      return;
    }
    matrix.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_MATRIX_ROW_ARRAY_REQUIRED',
          'Each matrix row must be an array.',
          `${path}[${rowIndex}]`,
        ));
        return;
      }
      row.forEach((cell, cellIndex) => {
        this.validateCellLikeValue(cell, `${path}[${rowIndex}][${cellIndex}]`, diagnostics);
      });
    });
  }

  private validateCellLikeValue(
    value: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_CELL_NUMBER_INVALID',
          'Cell numbers must be finite.',
          path,
        ));
      }
      return;
    }
    if (Array.isArray(value)) {
      this.validateJsonValue(value, path, diagnostics);
      return;
    }
    if (!isRecord(value)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_CELL_VALUE_INVALID',
        'Cell value is not JSON-compatible.',
        path,
      ));
      return;
    }
    if (!this.isCellSpec(value)) {
      this.validateJsonValue(value, path, diagnostics);
      return;
    }

    this.validateKnownProperties(value, path, diagnostics, 'cellSpec');
    const hasValue = Object.prototype.hasOwnProperty.call(value, 'value');
    const hasText = Object.prototype.hasOwnProperty.call(value, 'text');
    const hasFormula = Object.prototype.hasOwnProperty.call(value, 'formula');
    const hasResult = Object.prototype.hasOwnProperty.call(value, 'result');
    const hasCachedResult = Object.prototype.hasOwnProperty.call(value, 'cachedResult');
    const hasHyperlink = Object.prototype.hasOwnProperty.call(value, 'hyperlink');
    if (hasValue) this.validateJsonValue(value.value, `${path}.value`, diagnostics);
    if (hasValue && hasText) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_CONTENT_CONFLICT', 'cell.value and cell.text cannot both be set.', path));
    }
    if (hasFormula && (hasValue || hasText || hasHyperlink)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_FORMULA_CONFLICT', 'Formula cells cannot also define value, text, or hyperlink.', path));
    }
    if (hasResult && !hasFormula) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_RESULT_WITHOUT_FORMULA', 'cell.result requires cell.formula.', `${path}.result`));
    }
    if (hasCachedResult && !hasFormula) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_CACHED_RESULT_WITHOUT_FORMULA', 'cell.cachedResult requires cell.formula.', `${path}.cachedResult`));
    }
    if (value.type === 'formula' && !hasFormula) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_FORMULA_REQUIRED', 'cell.type formula requires cell.formula.', `${path}.formula`));
    }

    if (value.text != null && typeof value.text !== 'string') {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_TEXT_INVALID', 'cell.text must be a string.', `${path}.text`));
    }
    if (value.formula != null && !nonEmptyString(value.formula)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_FORMULA_INVALID', 'cell.formula must be a non-empty string.', `${path}.formula`));
    }
    if (value.type != null && !(SPREADSHEET_RENDER_PLAN_VALUE_TYPES as readonly unknown[]).includes(value.type)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_TYPE_INVALID', 'cell.type is not supported.', `${path}.type`));
    }
    if (value.note != null && typeof value.note !== 'string') {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_NOTE_INVALID', 'cell.note must be a string.', `${path}.note`));
    }
    if (value.hyperlink != null && typeof value.hyperlink !== 'string') {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_HYPERLINK_INVALID', 'cell.hyperlink must be a string.', `${path}.hyperlink`));
    }
    if (value.result != null && !['string', 'number', 'boolean'].includes(typeof value.result)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_RESULT_INVALID', 'cell.result must be a primitive value.', `${path}.result`));
    }
    if (value.cachedResult != null && !['string', 'number', 'boolean'].includes(typeof value.cachedResult)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_CACHED_RESULT_INVALID', 'cell.cachedResult must be a primitive value.', `${path}.cachedResult`));
    }
    if (value.kind != null && value.kind !== 'value' && value.kind !== 'formula') {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_KIND_INVALID', 'cell.kind must be value or formula.', `${path}.kind`));
    }
    if (value.kind === 'formula' && !hasFormula) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_CELL_FORMULA_REQUIRED', 'cell.kind formula requires cell.formula.', `${path}.formula`));
    }
    this.optionalPositiveNumber(value.colSpan, `${path}.colSpan`, diagnostics, true);
    this.optionalPositiveNumber(value.rowSpan, `${path}.rowSpan`, diagnostics, true);
    this.optionalPositiveNumber(value.width, `${path}.width`, diagnostics);
    this.optionalPositiveNumber(value.height, `${path}.height`, diagnostics);
    if (value.style != null) this.validateStyle(value.style, `${path}.style`, diagnostics);
  }

  private validateStyle(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!isRecord(input)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_STYLE_INVALID',
        'Cell style must be an object.',
        path,
      ));
      return;
    }
    this.validateKnownProperties(input, path, diagnostics, 'cellStyle');
    this.optionalStrings(input, ['fontName', 'color', 'fill', 'numFmt'], path, diagnostics);
    if (typeof input.color === 'string') this.validateColor(input.color, `${path}.color`, diagnostics);
    if (typeof input.fill === 'string') this.validateColor(input.fill, `${path}.fill`, diagnostics);
    this.optionalPositiveNumber(input.fontSize, `${path}.fontSize`, diagnostics);
    for (const field of ['bold', 'italic', 'underline', 'strike', 'wrapText'] as const) {
      this.optionalBoolean(input[field], `${path}.${field}`, diagnostics);
    }
    if (input.align != null && !(SPREADSHEET_PLAN_HORIZONTAL_ALIGNMENTS as readonly unknown[]).includes(input.align)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_STYLE_ALIGN_INVALID', 'style.align is not supported.', `${path}.align`));
    }
    if (input.verticalAlign != null && !(SPREADSHEET_PLAN_VERTICAL_ALIGNMENTS as readonly unknown[]).includes(input.verticalAlign)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_STYLE_VERTICAL_ALIGN_INVALID', 'style.verticalAlign is not supported.', `${path}.verticalAlign`));
    }
    if (input.border != null) {
      if (typeof input.border !== 'boolean' && !isRecord(input.border)) {
        diagnostics.push(this.error('SPREADSHEET_PLAN_STYLE_BORDER_INVALID', 'style.border must be a boolean or object.', `${path}.border`));
      } else if (isRecord(input.border)) {
        this.validateKnownProperties(input.border, `${path}.border`, diagnostics, 'cellBorder');
        for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
          const value = input.border[edge];
          if (value == null) continue;
          if (!isRecord(value)) {
            diagnostics.push(this.error('SPREADSHEET_PLAN_BORDER_EDGE_INVALID', 'Border edge must be an object.', `${path}.border.${edge}`));
            continue;
          }
          this.validateKnownProperties(value, `${path}.border.${edge}`, diagnostics, 'borderEdge');
          if (value.style != null && !(SPREADSHEET_PLAN_BORDER_STYLES as readonly unknown[]).includes(value.style)) {
            diagnostics.push(this.error('SPREADSHEET_PLAN_BORDER_STYLE_INVALID', 'Border style is not supported.', `${path}.border.${edge}.style`));
          }
          if (value.color != null && typeof value.color !== 'string') {
            diagnostics.push(this.error('SPREADSHEET_PLAN_BORDER_COLOR_INVALID', 'Border color must be a string.', `${path}.border.${edge}.color`));
          } else if (typeof value.color === 'string') {
            this.validateColor(value.color, `${path}.border.${edge}.color`, diagnostics);
          }
        }
      }
    }
  }

  private validateMerges(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!Array.isArray(input)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_MERGES_ARRAY_REQUIRED',
        'merges must be an array.',
        path,
      ));
      return;
    }
    input.forEach((merge, index) => {
      if (!isRecord(merge)) {
        diagnostics.push(this.error('SPREADSHEET_PLAN_MERGE_INVALID', 'Merge must be an object.', `${path}[${index}]`));
        return;
      }
      this.validateKnownProperties(merge, `${path}[${index}]`, diagnostics, 'mergeRange');
      if (!nonEmptyString(merge.from)) {
        diagnostics.push(this.error('SPREADSHEET_PLAN_MERGE_FROM_REQUIRED', 'merge.from is required.', `${path}[${index}].from`));
      }
      if (!nonEmptyString(merge.to)) {
        diagnostics.push(this.error('SPREADSHEET_PLAN_MERGE_TO_REQUIRED', 'merge.to is required.', `${path}[${index}].to`));
      }
    });
  }

  private validateFreeze(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!isRecord(input)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_FREEZE_INVALID', 'freeze must be an object.', path));
      return;
    }
    this.validateKnownProperties(input, path, diagnostics, 'freeze');
    this.optionalNonNegativeInteger(input.row, `${path}.row`, diagnostics);
    this.optionalNonNegativeInteger(input.column, `${path}.column`, diagnostics);
  }

  private validatePage(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!isRecord(input)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_PAGE_INVALID', 'page must be an object.', path));
      return;
    }
    this.validateKnownProperties(input, path, diagnostics, 'page');
    if (input.paperSize != null && !(SPREADSHEET_PLAN_PAPER_SIZES as readonly unknown[]).includes(input.paperSize)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_PAGE_SIZE_INVALID', 'page.paperSize is not supported.', `${path}.paperSize`));
    }
    if (input.orientation != null && input.orientation !== 'portrait' && input.orientation !== 'landscape') {
      diagnostics.push(this.error('SPREADSHEET_PLAN_PAGE_ORIENTATION_INVALID', 'page.orientation must be portrait or landscape.', `${path}.orientation`));
    }
    this.optionalBoolean(input.fitToPage, `${path}.fitToPage`, diagnostics);
    this.optionalNonNegativeInteger(input.fitToWidth, `${path}.fitToWidth`, diagnostics);
    this.optionalNonNegativeInteger(input.fitToHeight, `${path}.fitToHeight`, diagnostics);
    this.optionalStrings(input, ['header', 'footer'], path, diagnostics);
    this.optionalBoolean(input.showPageNumber, `${path}.showPageNumber`, diagnostics);
    if (input.margins != null) {
      if (!isRecord(input.margins)) {
        diagnostics.push(this.error('SPREADSHEET_PLAN_PAGE_MARGINS_INVALID', 'page.margins must be an object.', `${path}.margins`));
      } else {
        this.validateKnownProperties(input.margins, `${path}.margins`, diagnostics, 'pageMargins');
        for (const field of ['left', 'right', 'top', 'bottom', 'header', 'footer'] as const) {
          this.optionalPositiveNumber(input.margins[field], `${path}.margins.${field}`, diagnostics);
        }
      }
    }
  }

  private validateDesign(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!isRecord(input)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_DESIGN_INVALID', 'design must be an object.', path));
      return;
    }
    this.validateKnownProperties(input, path, diagnostics, 'design');
    if (!nonEmptyString(input.fontName)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_FONT_NAME_REQUIRED', 'design.fontName is required.', `${path}.fontName`));
    }
    this.requiredPositiveNumber(input.fontSize, `${path}.fontSize`, diagnostics);
    for (const field of ['freezeHeader', 'autoFilter', 'autoFit', 'striped', 'compact', 'wrapText'] as const) {
      if (typeof input[field] !== 'boolean') {
        diagnostics.push(this.error('SPREADSHEET_PLAN_DESIGN_BOOLEAN_REQUIRED', `design.${field} must be a boolean.`, `${path}.${field}`));
      }
    }
    this.requiredPositiveNumber(input.defaultColumnWidth, `${path}.defaultColumnWidth`, diagnostics);
    this.requiredPositiveNumber(input.minColumnWidth, `${path}.minColumnWidth`, diagnostics);
    this.requiredPositiveNumber(input.maxColumnWidth, `${path}.maxColumnWidth`, diagnostics);
    if (
      typeof input.minColumnWidth === 'number' &&
      typeof input.maxColumnWidth === 'number' &&
      input.minColumnWidth > input.maxColumnWidth
    ) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_DESIGN_WIDTH_RANGE_INVALID',
        'design.minColumnWidth must not exceed design.maxColumnWidth.',
        path,
      ));
    }
    if (
      typeof input.defaultColumnWidth === 'number' &&
      typeof input.minColumnWidth === 'number' &&
      input.defaultColumnWidth < input.minColumnWidth
    ) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_DEFAULT_WIDTH_BELOW_MINIMUM',
        'design.defaultColumnWidth must not be smaller than design.minColumnWidth.',
        `${path}.defaultColumnWidth`,
      ));
    }
    if (
      typeof input.defaultColumnWidth === 'number' &&
      typeof input.maxColumnWidth === 'number' &&
      input.defaultColumnWidth > input.maxColumnWidth
    ) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_DEFAULT_WIDTH_ABOVE_MAXIMUM',
        'design.defaultColumnWidth must not exceed design.maxColumnWidth.',
        `${path}.defaultColumnWidth`,
      ));
    }
    this.optionalPositiveNumber(input.defaultRowHeight, `${path}.defaultRowHeight`, diagnostics);
    this.optionalStrings(input, [
      'intent',
      'primaryColor',
      'accentColor',
      'headerFill',
      'textColor',
      'mutedColor',
      'borderColor',
      'summaryFill',
      'zebraFill',
      'currencySymbol',
    ], path, diagnostics);
    for (const colorField of [
      'primaryColor',
      'accentColor',
      'headerFill',
      'textColor',
      'mutedColor',
      'borderColor',
      'summaryFill',
      'zebraFill',
    ] as const) {
      if (typeof input[colorField] === 'string') {
        this.validateColor(input[colorField], `${path}.${colorField}`, diagnostics);
      }
    }
    if (input.page != null) this.validatePage(input.page, `${path}.page`, diagnostics);
  }

  private validateOutput(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!isRecord(input)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_OUTPUT_INVALID', 'output must be an object.', path));
      return;
    }
    this.validateKnownProperties(input, path, diagnostics, 'output');
    if (input.format !== 'xlsx') {
      diagnostics.push(this.error('SPREADSHEET_PLAN_FORMAT_INVALID', 'output.format must be xlsx.', `${path}.format`));
    }
    if (!nonEmptyString(input.filename)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_FILENAME_REQUIRED', 'output.filename is required.', `${path}.filename`));
    }
  }

  private validateRationale(
    input: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (input == null) return;
    if (!isRecord(input)) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_RATIONALE_INVALID', 'rationale must be an object.', path));
      return;
    }
    this.validateKnownProperties(input, path, diagnostics, 'rationale');
    this.optionalStrings(input, ['structure', 'design'], path, diagnostics);
  }

  private validateColor(
    value: string,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (!/^#?(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim())) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_COLOR_INVALID',
        'Colors must be 6- or 8-digit hexadecimal values.',
        path,
      ));
    }
  }

  private validateJsonValue(
    value: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_JSON_NUMBER_INVALID',
          'JSON values cannot contain NaN or Infinity.',
          path,
        ));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => this.validateJsonValue(entry, `${path}[${index}]`, diagnostics));
      return;
    }
    if (!isRecord(value)) {
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_JSON_VALUE_INVALID',
        'Value must be JSON-compatible.',
        path,
      ));
      return;
    }
    Object.entries(value).forEach(([key, entry]) => {
      this.validateJsonValue(entry, `${path}.${key}`, diagnostics);
    });
  }

  private validateKnownProperties(
    input: Record<string, unknown>,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
    definition?: string,
  ): void {
    const schema = SPREADSHEET_RENDER_PLAN_SCHEMA as {
      properties?: Record<string, unknown>;
      $defs?: Record<string, { properties?: Record<string, unknown> }>;
    };
    const properties = definition
      ? schema.$defs?.[definition]?.properties
      : schema.properties;
    if (!properties) return;
    for (const key of Object.keys(input)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) continue;
      diagnostics.push(this.error(
        'SPREADSHEET_PLAN_UNKNOWN_FIELD',
        `Unknown field: ${key}.`,
        path === '$' ? `$.${key}` : `${path}.${key}`,
      ));
    }
  }

  private isCellSpec(value: Record<string, unknown>): boolean {
    return ['kind', 'value', 'text', 'formula', 'result', 'cachedResult', 'type', 'style', 'note', 'hyperlink', 'colSpan', 'rowSpan', 'width', 'height']
      .some((key) => Object.prototype.hasOwnProperty.call(value, key));
  }

  private optionalStrings(
    input: Record<string, unknown>,
    fields: readonly string[],
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    for (const field of fields) {
      if (input[field] != null && typeof input[field] !== 'string') {
        diagnostics.push(this.error(
          'SPREADSHEET_PLAN_STRING_INVALID',
          `${field} must be a string.`,
          `${path}.${field}`,
        ));
      }
    }
  }

  private optionalBoolean(
    value: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (value != null && typeof value !== 'boolean') {
      diagnostics.push(this.error('SPREADSHEET_PLAN_BOOLEAN_INVALID', 'Value must be a boolean.', path));
    }
  }

  private requiredPositiveNumber(
    value: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_POSITIVE_NUMBER_REQUIRED', 'Value must be a positive number.', path));
    }
  }

  private optionalPositiveNumber(
    value: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
    integer = false,
  ): void {
    if (value == null) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
      diagnostics.push(this.error(
        integer ? 'SPREADSHEET_PLAN_POSITIVE_INTEGER_INVALID' : 'SPREADSHEET_PLAN_POSITIVE_NUMBER_INVALID',
        integer ? 'Value must be a positive integer.' : 'Value must be a positive number.',
        path,
      ));
    }
  }

  private optionalNonNegativeInteger(
    value: unknown,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (value == null) return;
    if (!Number.isInteger(value) || Number(value) < 0) {
      diagnostics.push(this.error('SPREADSHEET_PLAN_NON_NEGATIVE_INTEGER_INVALID', 'Value must be a non-negative integer.', path));
    }
  }

  private error(
    code: string,
    message: string,
    path: string,
    repairable = true,
  ): RenderPlanDiagnostic {
    return {
      stage: 'validation',
      code,
      message,
      path,
      severity: 'error',
      repairable,
    };
  }
}
