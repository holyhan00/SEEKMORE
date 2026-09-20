import { Injectable } from '@nestjs/common';
import {
  failure,
  success,
  type RenderPlanDiagnostic,
  type RenderStageResult,
} from '../../planning/core/render-plan-diagnostics.types';
import type {
  SpreadsheetPlanBlock,
  SpreadsheetPlanMatrixCell,
  SpreadsheetPlanMatrixRow,
  SpreadsheetPlanMergeRange,
  SpreadsheetPlanTable,
  SpreadsheetRenderPlan,
} from '../../planning/spreadsheet/spreadsheet-render-plan.types';

interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
  path: string;
}

@Injectable()
export class XlsxExecutionValidator {
  private readonly excelMaxRows = 1_048_576;
  private readonly excelMaxColumns = 16_384;
  private readonly maxWorkbookCells = 5_000_000;
  private readonly maxCellTextLength = 32_767;
  private readonly maxFormulaLength = 8_192;
  private readonly maxHyperlinkLength = 2_048;
  private readonly maxNoteLength = 32_767;
  private readonly maxColumnWidth = 255;
  private readonly maxRowHeight = 409;
  private readonly invalidSheetName = /[\\/?*\[\]:]/;

  validate(plan: SpreadsheetRenderPlan): RenderStageResult<SpreadsheetRenderPlan> {
    const diagnostics: RenderPlanDiagnostic[] = [];
    const normalizedNames = new Set<string>();
    const normalizedTableNames = new Set<string>();
    let workbookCells = 0;

    this.validatePhysicalDimensions(plan, diagnostics);

    plan.workbook.sheets.forEach((sheet, sheetIndex) => {
      const path = `$.workbook.sheets[${sheetIndex}]`;
      const name = sheet.name.trim();
      if (name.length > 31) {
        diagnostics.push(this.error(
          'XLSX_SHEET_NAME_TOO_LONG',
          'Excel sheet names cannot exceed 31 characters.',
          `${path}.name`,
          true,
        ));
      }
      if (this.invalidSheetName.test(name)) {
        diagnostics.push(this.error(
          'XLSX_SHEET_NAME_INVALID_CHARACTERS',
          'Excel sheet names cannot contain \\, /, ?, *, [, ], or :.',
          `${path}.name`,
          true,
        ));
      }
      if (name.startsWith("'") || name.endsWith("'")) {
        diagnostics.push(this.error(
          'XLSX_SHEET_NAME_APOSTROPHE_INVALID',
          'Excel sheet names cannot start or end with an apostrophe.',
          `${path}.name`,
          true,
        ));
      }
      const normalizedName = name.toLocaleLowerCase();
      if (normalizedNames.has(normalizedName)) {
        diagnostics.push(this.error(
          'XLSX_SHEET_NAME_COLLISION',
          `Excel sheet name collides case-insensitively: ${name}.`,
          `${path}.name`,
          true,
        ));
      }
      normalizedNames.add(normalizedName);

      let rowCursor = 1;
      let maxColumn = 1;
      if (sheet.title) rowCursor += 1 + (sheet.subtitle ? 0 : 1);
      if (sheet.subtitle) rowCursor += 2;

      sheet.blocks.forEach((block, blockIndex) => {
        if (block.type !== 'table') return;
        const blockTablePath = `${path}.blocks[${blockIndex}].table`;
        if (this.tableUsesStructuredReference(block.table) && !block.table.name) {
          diagnostics.push(this.error(
            'XLSX_STRUCTURED_REFERENCE_TABLE_REQUIRED',
            'Structured-reference formulas require table.name so the renderer can create a real Excel table.',
            `${blockTablePath}.name`,
            true,
          ));
        }
        if (!block.table.name) return;
        const tablePath = `${blockTablePath}.name`;
        const tableName = block.table.name.trim();
        if (!/^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_.\u0080-\uFFFF]*$/.test(tableName)) {
          diagnostics.push(this.error(
            'XLSX_TABLE_NAME_INVALID',
            'Excel table names must start with a letter or underscore and contain no spaces or cell-reference punctuation.',
            tablePath,
            true,
          ));
        }
        if (/^[A-Za-z]{1,3}[1-9][0-9]*$/.test(tableName)) {
          diagnostics.push(this.error(
            'XLSX_TABLE_NAME_CELL_REFERENCE_CONFLICT',
            'Excel table names cannot look like cell references.',
            tablePath,
            true,
          ));
        }
        const normalizedTableName = tableName.toLocaleLowerCase();
        if (normalizedTableNames.has(normalizedTableName)) {
          diagnostics.push(this.error(
            'XLSX_TABLE_NAME_COLLISION',
            `Excel table name must be unique across the workbook: ${tableName}.`,
            tablePath,
            true,
          ));
        }
        normalizedTableNames.add(normalizedTableName);
        if (block.table.showHeader === false) {
          diagnostics.push(this.error(
            'XLSX_TABLE_HEADER_REQUIRED',
            'A named Excel table requires showHeader to be true.',
            `${path}.blocks[${blockIndex}].table.showHeader`,
            true,
          ));
        }
        if (!block.table.columns || block.table.matrix) {
          diagnostics.push(this.error(
            'XLSX_TABLE_STRUCTURED_ROWS_REQUIRED',
            'A named Excel table requires columns with structured rows; matrix tables cannot create Excel table parts.',
            `${path}.blocks[${blockIndex}].table`,
            true,
          ));
        }
      });

      const autoFilterTables = sheet.blocks.filter((block) =>
        block.type === 'table' &&
        !block.table.name &&
        block.table.showHeader !== false &&
        (block.table.autoFilter ?? plan.design.autoFilter),
      );
      if (autoFilterTables.length > 1) {
        diagnostics.push(this.error(
          'XLSX_MULTIPLE_AUTOFILTERS_UNSUPPORTED',
          'ExcelJS supports one worksheet auto-filter range; only one table per sheet may enable autoFilter.',
          `${path}.blocks`,
          true,
        ));
      }

      sheet.blocks.forEach((block, blockIndex) => {
        const blockPath = `${path}.blocks[${blockIndex}]`;
        const dimensions = this.validateBlock(block, blockPath, diagnostics);
        rowCursor += dimensions.rows;
        maxColumn = Math.max(maxColumn, dimensions.columns);
        workbookCells += dimensions.rows * dimensions.columns;
      });

      const usedRows = Math.max(0, rowCursor - 1);
      if (usedRows > this.excelMaxRows) {
        diagnostics.push(this.error(
          'XLSX_SHEET_ROW_LIMIT_EXCEEDED',
          `Sheet requires ${usedRows} rows, exceeding Excel limit ${this.excelMaxRows}.`,
          path,
          false,
        ));
      }
      if (maxColumn > this.excelMaxColumns) {
        diagnostics.push(this.error(
          'XLSX_SHEET_COLUMN_LIMIT_EXCEEDED',
          `Sheet requires ${maxColumn} columns, exceeding Excel limit ${this.excelMaxColumns}.`,
          path,
          false,
        ));
      }
      if ((sheet.freeze?.row ?? 0) > usedRows) {
        diagnostics.push(this.error(
          'XLSX_FREEZE_ROW_OUT_OF_RANGE',
          'freeze.row exceeds the rendered sheet row count.',
          `${path}.freeze.row`,
          true,
        ));
      }
      if ((sheet.freeze?.column ?? 0) > maxColumn) {
        diagnostics.push(this.error(
          'XLSX_FREEZE_COLUMN_OUT_OF_RANGE',
          'freeze.column exceeds the rendered sheet column count.',
          `${path}.freeze.column`,
          true,
        ));
      }
    });

    if (workbookCells > this.maxWorkbookCells) {
      diagnostics.push(this.error(
        'XLSX_WORKBOOK_CELL_BUDGET_EXCEEDED',
        `Workbook requires approximately ${workbookCells} cells, exceeding the execution budget ${this.maxWorkbookCells}.`,
        '$.workbook',
        false,
      ));
    }

    return diagnostics.some((item) => item.severity === 'error')
      ? failure(diagnostics)
      : success(plan, diagnostics);
  }

  private validatePhysicalDimensions(
    plan: SpreadsheetRenderPlan,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    for (const [field, value] of [
      ['defaultColumnWidth', plan.design.defaultColumnWidth],
      ['minColumnWidth', plan.design.minColumnWidth],
      ['maxColumnWidth', plan.design.maxColumnWidth],
    ] as const) {
      if (value > this.maxColumnWidth) {
        diagnostics.push(this.error(
          'XLSX_COLUMN_WIDTH_LIMIT_EXCEEDED',
          `design.${field} exceeds Excel column width limit ${this.maxColumnWidth}.`,
          `$.design.${field}`,
          true,
        ));
      }
    }
    if ((plan.design.defaultRowHeight ?? 0) > this.maxRowHeight) {
      diagnostics.push(this.error(
        'XLSX_ROW_HEIGHT_LIMIT_EXCEEDED',
        `design.defaultRowHeight exceeds Excel row height limit ${this.maxRowHeight}.`,
        '$.design.defaultRowHeight',
        true,
      ));
    }

    plan.workbook.sheets.forEach((sheet, sheetIndex) => {
      sheet.blocks.forEach((block, blockIndex) => {
        const path = `$.workbook.sheets[${sheetIndex}].blocks[${blockIndex}]`;
        if (block.type === 'text') {
          if ((block.height ?? 0) > this.maxRowHeight) {
            diagnostics.push(this.error(
              'XLSX_ROW_HEIGHT_LIMIT_EXCEEDED',
              `Text block height exceeds Excel row height limit ${this.maxRowHeight}.`,
              `${path}.height`,
              true,
            ));
          }
          return;
        }
        if (block.type === 'spacer') return;
        const matrix = block.type === 'matrix' ? block.matrix : block.table.matrix;
        matrix?.forEach((row, rowIndex) => row.forEach((cell, cellIndex) => {
          if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return;
          const value = cell as Record<string, unknown>;
          if (!this.isCellSpec(value)) return;
          this.validateCellDimensions(
            value,
            `${path}.${block.type === 'table' ? 'table.' : ''}matrix[${rowIndex}][${cellIndex}]`,
            diagnostics,
          );
        }));
        if (block.type !== 'table') return;
        (block.table.columns ?? []).forEach((column, columnIndex) => {
          for (const field of ['width', 'minWidth', 'maxWidth'] as const) {
            const value = column[field];
            if (value != null && value > this.maxColumnWidth) {
              diagnostics.push(this.error(
                'XLSX_COLUMN_WIDTH_LIMIT_EXCEEDED',
                `column.${field} exceeds Excel column width limit ${this.maxColumnWidth}.`,
                `${path}.table.columns[${columnIndex}].${field}`,
                true,
              ));
            }
          }
          if (
            column.minWidth != null &&
            column.minWidth > plan.design.maxColumnWidth
          ) {
            diagnostics.push(this.error(
              'XLSX_COLUMN_WIDTH_RANGE_UNRESOLVABLE',
              'column.minWidth exceeds design.maxColumnWidth.',
              `${path}.table.columns[${columnIndex}].minWidth`,
              true,
            ));
          }
          if (
            column.maxWidth != null &&
            column.maxWidth < plan.design.minColumnWidth
          ) {
            diagnostics.push(this.error(
              'XLSX_COLUMN_WIDTH_RANGE_UNRESOLVABLE',
              'column.maxWidth is smaller than design.minColumnWidth.',
              `${path}.table.columns[${columnIndex}].maxWidth`,
              true,
            ));
          }
        });
      });
    });
  }

  private validateCellDimensions(
    cell: Record<string, unknown>,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (typeof cell.width === 'number' && cell.width > this.maxColumnWidth) {
      diagnostics.push(this.error(
        'XLSX_COLUMN_WIDTH_LIMIT_EXCEEDED',
        `Cell width exceeds Excel column width limit ${this.maxColumnWidth}.`,
        `${path}.width`,
        true,
      ));
    }
    if (typeof cell.height === 'number' && cell.height > this.maxRowHeight) {
      diagnostics.push(this.error(
        'XLSX_ROW_HEIGHT_LIMIT_EXCEEDED',
        `Cell height exceeds Excel row height limit ${this.maxRowHeight}.`,
        `${path}.height`,
        true,
      ));
    }
  }

  private validateBlock(
    block: SpreadsheetPlanBlock,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): { rows: number; columns: number } {
    if (block.type === 'spacer') {
      return { rows: block.rows ?? 1, columns: 1 };
    }
    if (block.type === 'text') {
      this.validateText(block.value, `${path}.value`, diagnostics);
      return {
        rows: 1 + (block.spacingAfter ?? 0),
        columns: block.mergeAcross ?? 1,
      };
    }
    if (block.type === 'matrix') {
      const renderedColumns = this.validateMatrix(
        block.matrix,
        block.merges ?? [],
        path,
        block.startColumn ?? 1,
        diagnostics,
      );
      return { rows: block.matrix.length, columns: renderedColumns };
    }
    return this.validateTable(
      block.table,
      path,
      block.startColumn ?? 1,
      diagnostics,
    );
  }

  private validateTable(
    table: SpreadsheetPlanTable,
    path: string,
    startColumn: number,
    diagnostics: RenderPlanDiagnostic[],
  ): { rows: number; columns: number } {
    const columns = table.columns ?? [];
    const columnCount = table.matrix
      ? Math.max(1, ...table.matrix.map((row) => row.reduce<number>(
          (total, cell) => total + this.cellSpan(cell).colSpan,
          0,
        )))
      : Math.max(1, columns.length);
    const matrix: SpreadsheetPlanMatrixRow[] = [];
    if (table.title) matrix.push([{ value: table.title, colSpan: columnCount }]);
    if (table.matrix) {
      matrix.push(...table.matrix);
    } else {
      if (table.showHeader !== false) {
        matrix.push(columns.map((column) => ({ value: column.header, type: 'text' })));
      }
      for (const row of table.rows ?? []) {
        matrix.push(columns.map((column) => this.validationCellForColumn(row, column)));
      }
      for (const row of table.summaryRows ?? []) {
        matrix.push(columns.map((column) => this.validationCellForColumn(row, column)));
      }
    }
    if (table.caption) matrix.push([{ value: table.caption, colSpan: columnCount }]);

    const renderedColumns = this.validateMatrix(
      matrix,
      table.merges ?? [],
      `${path}.table`,
      startColumn,
      diagnostics,
    );
    if (table.note) this.validateText(table.note, `${path}.table.note`, diagnostics, this.maxNoteLength);

    return {
      rows: matrix.length + (table.note ? 1 : 0) + 1,
      columns: renderedColumns,
    };
  }

  private validateMatrix(
    matrix: SpreadsheetPlanMatrixRow[],
    merges: SpreadsheetPlanMergeRange[],
    path: string,
    startColumn: number,
    diagnostics: RenderPlanDiagnostic[],
  ): number {
    const ranges: CellRange[] = [];
    const occupied = new Map<number, Set<number>>();
    let maxColumns = 1;

    matrix.forEach((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const rowOccupied = occupied.get(rowNumber) ?? new Set<number>();
      let columnCursor = 1;
      row.forEach((cell, cellIndex) => {
        while (rowOccupied.has(columnCursor)) columnCursor += 1;
        const cellPath = `${path}.matrix[${rowIndex}][${cellIndex}]`;
        this.validateCell(cell, cellPath, diagnostics);
        const span = this.cellSpan(cell);
        const range: CellRange = {
          top: rowNumber,
          left: columnCursor,
          bottom: rowNumber + span.rowSpan - 1,
          right: columnCursor + span.colSpan - 1,
          path: cellPath,
        };
        if (span.colSpan > 1 || span.rowSpan > 1) ranges.push(range);

        for (let targetRow = range.top; targetRow <= range.bottom; targetRow += 1) {
          const targetOccupied = occupied.get(targetRow) ?? new Set<number>();
          for (let targetColumn = range.left; targetColumn <= range.right; targetColumn += 1) {
            targetOccupied.add(targetColumn);
          }
          occupied.set(targetRow, targetOccupied);
        }

        maxColumns = Math.max(maxColumns, range.right);
        columnCursor = range.right + 1;
      });
    });

    merges.forEach((merge, index) => {
      const mergePath = `${path}.merges[${index}]`;
      const range = this.parseMerge(merge, mergePath, diagnostics);
      if (range) ranges.push(range);
    });

    for (const range of ranges) {
      if (range.bottom > matrix.length || range.right > maxColumns) {
        diagnostics.push(this.error(
          'XLSX_MERGE_OUT_OF_RANGE',
          'Merge range exceeds the matrix bounds.',
          range.path,
          true,
        ));
      }
      if (startColumn + range.right - 1 > this.excelMaxColumns) {
        diagnostics.push(this.error(
          'XLSX_MERGE_COLUMN_LIMIT_EXCEEDED',
          'Merge range exceeds the Excel column limit after block placement.',
          range.path,
          false,
        ));
      }
    }

    for (let left = 0; left < ranges.length; left += 1) {
      for (let right = left + 1; right < ranges.length; right += 1) {
        if (this.sameRange(ranges[left], ranges[right])) continue;
        if (this.overlaps(ranges[left], ranges[right])) {
          diagnostics.push(this.error(
            'XLSX_MERGE_CONFLICT',
            `Merge range conflicts with ${ranges[left].path}.`,
            ranges[right].path,
            true,
          ));
        }
      }
    }

    return startColumn + maxColumns - 1;
  }

  private validateCell(
    cell: SpreadsheetPlanMatrixCell,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (cell == null) return;
    if (typeof cell === 'string') {
      this.validateText(cell, path, diagnostics);
      return;
    }
    if (typeof cell === 'number') {
      if (!Number.isFinite(cell)) {
        diagnostics.push(this.error(
          'XLSX_CELL_NUMBER_INVALID',
          'Excel cells cannot contain NaN or Infinity.',
          path,
          true,
        ));
      }
      return;
    }
    if (typeof cell === 'boolean' || Array.isArray(cell)) return;
    if (typeof cell !== 'object') {
      diagnostics.push(this.error(
        'XLSX_CELL_VALUE_UNSUPPORTED',
        'Cell value cannot be serialized by ExcelJS.',
        path,
        true,
      ));
      return;
    }

    const value = cell as Record<string, unknown>;
    if (!this.isCellSpec(value)) return;
    if (typeof value.text === 'string') this.validateText(value.text, `${path}.text`, diagnostics);
    if (typeof value.note === 'string') this.validateText(value.note, `${path}.note`, diagnostics, this.maxNoteLength);
    if (typeof value.formula === 'string') this.validateFormula(value.formula, `${path}.formula`, diagnostics);
    if (typeof value.hyperlink === 'string') this.validateHyperlink(value.hyperlink, `${path}.hyperlink`, diagnostics);
    if (typeof value.value === 'string') this.validateText(value.value, `${path}.value`, diagnostics);
    if (typeof value.value === 'number' && !Number.isFinite(value.value)) {
      diagnostics.push(this.error('XLSX_CELL_NUMBER_INVALID', 'Excel cells cannot contain NaN or Infinity.', `${path}.value`, true));
    }
  }

  private validateFormula(
    formula: string,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const normalized = formula.replace(/^=/, '').trim();
    if (!normalized) {
      diagnostics.push(this.error('XLSX_FORMULA_EMPTY', 'Formula cannot be empty.', path, true));
      return;
    }
    if (normalized.length > this.maxFormulaLength) {
      diagnostics.push(this.error('XLSX_FORMULA_TOO_LONG', `Formula exceeds ${this.maxFormulaLength} characters.`, path, true));
    }
    const hasExternalWorkbookReference =
      /\[[^\]]+\.(?:xlsx?|xlsm|xlsb)\][^!]*!/i.test(normalized) ||
      /\[[^\]]+\][^!]*!/i.test(normalized);
    if (hasExternalWorkbookReference || /https?:\/\//i.test(normalized) || normalized.includes('|')) {
      diagnostics.push(this.error(
        'XLSX_FORMULA_EXTERNAL_REFERENCE_FORBIDDEN',
        'External workbook, URL, and DDE-style formula references are not allowed.',
        path,
        false,
      ));
    }
  }

  private validateHyperlink(
    hyperlink: string,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    if (hyperlink.length > this.maxHyperlinkLength) {
      diagnostics.push(this.error('XLSX_HYPERLINK_TOO_LONG', `Hyperlink exceeds ${this.maxHyperlinkLength} characters.`, path, true));
      return;
    }
    if (hyperlink.startsWith('#')) return;
    try {
      const url = new URL(hyperlink);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
        diagnostics.push(this.error('XLSX_HYPERLINK_PROTOCOL_FORBIDDEN', 'Only http, https, mailto, and internal workbook links are allowed.', path, false));
      }
    } catch {
      diagnostics.push(this.error('XLSX_HYPERLINK_INVALID', 'Hyperlink must be a valid URL or internal workbook link.', path, true));
    }
  }

  private validateText(
    value: string,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
    maximum = this.maxCellTextLength,
  ): void {
    if (value.length > maximum) {
      diagnostics.push(this.error(
        'XLSX_TEXT_TOO_LONG',
        `Text exceeds Excel limit ${maximum} characters.`,
        path,
        true,
      ));
    }
  }

  private parseMerge(
    merge: SpreadsheetPlanMergeRange,
    path: string,
    diagnostics: RenderPlanDiagnostic[],
  ): CellRange | undefined {
    const from = this.parseAddress(merge.from);
    const to = this.parseAddress(merge.to);
    if (!from || !to) {
      diagnostics.push(this.error(
        'XLSX_MERGE_ADDRESS_INVALID',
        'Merge addresses must use A1 notation.',
        path,
        true,
      ));
      return undefined;
    }
    if (from.row > to.row || from.column > to.column) {
      diagnostics.push(this.error(
        'XLSX_MERGE_RANGE_REVERSED',
        'Merge range must run from top-left to bottom-right.',
        path,
        true,
      ));
      return undefined;
    }
    return {
      top: from.row,
      left: from.column,
      bottom: to.row,
      right: to.column,
      path,
    };
  }

  private parseAddress(address: string): { row: number; column: number } | undefined {
    const match = /^([A-Z]{1,3})([1-9]\d*)$/i.exec(address.trim());
    if (!match) return undefined;
    let column = 0;
    for (const character of match[1].toUpperCase()) {
      column = column * 26 + character.charCodeAt(0) - 64;
    }
    const row = Number(match[2]);
    if (row > this.excelMaxRows || column > this.excelMaxColumns) return undefined;
    return { row, column };
  }

  private cellSpan(cell: SpreadsheetPlanMatrixCell): { colSpan: number; rowSpan: number } {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
      return { colSpan: 1, rowSpan: 1 };
    }
    const value = cell as Record<string, unknown>;
    if (!this.isCellSpec(value)) return { colSpan: 1, rowSpan: 1 };
    return {
      colSpan: this.positiveInteger(value.colSpan),
      rowSpan: this.positiveInteger(value.rowSpan),
    };
  }

  private positiveInteger(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : 1;
  }

  private isCellSpec(value: Record<string, unknown>): boolean {
    return ['kind', 'value', 'text', 'formula', 'result', 'cachedResult', 'type', 'style', 'note', 'hyperlink', 'colSpan', 'rowSpan', 'width', 'height']
      .some((key) => Object.prototype.hasOwnProperty.call(value, key));
  }

  private tableUsesStructuredReference(table: SpreadsheetPlanTable): boolean {
    const formulas: string[] = [];
    for (const column of table.columns ?? []) {
      if (column.formula) formulas.push(column.formula);
    }
    for (const rows of [table.rows ?? [], table.summaryRows ?? []]) {
      for (const row of rows) {
        for (const value of Object.values(row)) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          const formula = (value as Record<string, unknown>).formula;
          if (typeof formula === 'string') formulas.push(formula);
        }
      }
    }
    for (const row of table.matrix ?? []) {
      for (const value of row) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const formula = (value as Record<string, unknown>).formula;
        if (typeof formula === 'string') formulas.push(formula);
      }
    }
    return formulas.some((formula) => /(?:\[@\[|[A-Za-z_-￿][A-Za-z0-9_.-￿]*\[)/.test(formula));
  }

  private validationCellForColumn(
    row: Record<string, unknown>,
    column: NonNullable<SpreadsheetPlanTable['columns']>[number],
  ): SpreadsheetPlanMatrixCell {
    const value = this.getByPath(row, column.key);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (this.isCellSpec(record)) {
        return {
          ...record,
          formula: record.formula ?? column.formula,
          type: record.type ?? column.type ?? 'auto',
        } as SpreadsheetPlanMatrixCell;
      }
    }
    if (column.formula) {
      return {
        formula: column.formula,
        result: value == null || ['string', 'number', 'boolean'].includes(typeof value)
          ? value as string | number | boolean | null
          : undefined,
        type: column.type ?? 'formula',
      };
    }
    return {
      value: value as never,
      type: column.type ?? 'auto',
    };
  }

  private getByPath(row: Record<string, unknown>, key: string): unknown {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    if (!key.includes('.')) return row[key];
    return key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[segment];
    }, row);
  }

  private sameRange(left: CellRange, right: CellRange): boolean {
    return left.top === right.top &&
      left.left === right.left &&
      left.bottom === right.bottom &&
      left.right === right.right;
  }

  private overlaps(left: CellRange, right: CellRange): boolean {
    return !(
      left.right < right.left ||
      right.right < left.left ||
      left.bottom < right.top ||
      right.bottom < left.top
    );
  }

  private error(
    code: string,
    message: string,
    path: string,
    repairable: boolean,
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
