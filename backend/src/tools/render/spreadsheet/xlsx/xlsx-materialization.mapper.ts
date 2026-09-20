import { Injectable } from '@nestjs/common';
import { cleanHex } from '../../planning/core/render-plan.util';
import type {
  SpreadsheetPlanBlock,
  SpreadsheetPlanCell,
  SpreadsheetPlanCellStyle,
  SpreadsheetPlanColumn,
  SpreadsheetPlanMatrixCell,
  SpreadsheetPlanMatrixRow,
  SpreadsheetPlanPage,
  SpreadsheetPlanTable,
  SpreadsheetPlanValueType,
  SpreadsheetRenderPlan,
} from '../../planning/spreadsheet/spreadsheet-render-plan.types';
import {
  normalizeFormula,
  resolveStructuredSpreadsheetCell,
} from './spreadsheet-cell.resolver';
import type {
  XlsxBlockRuntime,
  XlsxCellRuntime,
  XlsxMatrixBlockRuntime,
  XlsxMergeRuntime,
  XlsxPageRuntime,
  XlsxResolvedTheme,
  XlsxRuntimeValue,
  XlsxWorkbookRuntime,
  XlsxWorksheetRuntime,
} from './xlsx-runtime.types';

interface MaterializedTable {
  block: XlsxMatrixBlockRuntime;
  headerRowOffset?: number;
  trailingBlocks: XlsxBlockRuntime[];
}

@Injectable()
export class XlsxMaterializationMapper {
  materialize(plan: SpreadsheetRenderPlan): XlsxWorkbookRuntime {
    const theme = this.resolveTheme(plan);
    return {
      title: plan.workbook.title,
      subtitle: plan.workbook.subtitle,
      theme,
      sheets: plan.workbook.sheets.map((sheet) =>
        this.materializeSheet(sheet, plan, theme),
      ),
    };
  }

  estimateMatrixWidths(
    matrix: XlsxCellRuntime[][],
    options: { min: number; max: number; defaultWidth: number },
  ): number[] {
    const maximumColumns = this.maxMatrixWidth(matrix);
    return Array.from({ length: maximumColumns }, (_, columnIndex) => {
      const cells = matrix
        .map((row) => row.find((cell) => cell.column === columnIndex + 1))
        .filter((cell): cell is XlsxCellRuntime => Boolean(cell));
      const explicit = cells
        .map((cell) => cell.width)
        .find((value): value is number => typeof value === 'number');
      if (explicit != null) return explicit;
      const values = cells.map((cell) => this.cellText(cell));
      if (!values.length) return options.defaultWidth;
      const longest = Math.max(...values.slice(0, 100).map((value) => this.visualLength(value)));
      return Math.max(options.min, Math.min(options.max, longest + 4));
    });
  }

  private materializeSheet(
    sheet: SpreadsheetRenderPlan['workbook']['sheets'][number],
    plan: SpreadsheetRenderPlan,
    theme: XlsxResolvedTheme,
  ): XlsxWorksheetRuntime {
    const blocks: XlsxBlockRuntime[] = [];
    let rowCursor = 1;
    let inferredFreezeRow = 0;

    if (sheet.title) {
      const titleBlock: XlsxBlockRuntime = {
        type: 'text',
        value: sheet.title,
        style: {
          bold: true,
          fontSize: Math.max(theme.fontSize + 5, 16),
          align: 'center',
          color: theme.primaryColor,
        },
        mergeAcross: this.resolveSheetWidth(sheet),
        spacingAfter: sheet.subtitle ? 0 : 1,
      };
      blocks.push(titleBlock);
      rowCursor += this.blockRows(titleBlock);
    }

    if (sheet.subtitle) {
      const subtitleBlock: XlsxBlockRuntime = {
        type: 'text',
        value: sheet.subtitle,
        style: {
          italic: true,
          align: 'center',
          color: theme.mutedColor,
        },
        mergeAcross: this.resolveSheetWidth(sheet),
        spacingAfter: 1,
      };
      blocks.push(subtitleBlock);
      rowCursor += this.blockRows(subtitleBlock);
    }

    for (const block of sheet.blocks) {
      if (block.type === 'table') {
        const table = this.materializeTable(block.table, block.startColumn ?? 1, plan, theme);
        if (
          inferredFreezeRow === 0 &&
          table.headerRowOffset != null &&
          (block.table.freezeHeader ?? plan.design.freezeHeader)
        ) {
          inferredFreezeRow = rowCursor + table.headerRowOffset;
        }
        blocks.push(table.block, ...table.trailingBlocks);
        rowCursor += this.blockRows(table.block);
        for (const trailing of table.trailingBlocks) rowCursor += this.blockRows(trailing);
        continue;
      }

      const materialized = this.materializeBlock(block, plan, theme);
      blocks.push(materialized);
      rowCursor += this.blockRows(materialized);
    }

    return {
      name: sheet.name,
      blocks,
      freeze: {
        row: sheet.freeze?.row ?? inferredFreezeRow,
        column: sheet.freeze?.column ?? 0,
      },
      page: this.resolvePage(plan.design.page, sheet.page),
    };
  }

  private materializeBlock(
    block: Exclude<SpreadsheetPlanBlock, { type: 'table' }>,
    plan: SpreadsheetRenderPlan,
    theme: XlsxResolvedTheme,
  ): XlsxBlockRuntime {
    if (block.type === 'spacer') {
      return { type: 'spacer', rows: block.rows ?? 1 };
    }
    if (block.type === 'text') {
      return {
        type: 'text',
        value: block.value,
        style: block.style,
        mergeAcross: block.mergeAcross,
        height: block.height,
        spacingAfter: block.spacingAfter,
      };
    }

    const matrix = this.layoutMatrix(this.normalizeMatrix(block.matrix, block.style));
    this.resolvePhysicalCellWidths(matrix, [], theme);
    const autoFit = plan.design.autoFit;
    return {
      type: 'matrix',
      matrix,
      merges: this.combineMerges(block.merges ?? [], this.inferMerges(matrix)),
      startColumn: block.startColumn ?? 1,
      autoFit,
      columnWidths: autoFit
        ? this.estimateMatrixWidths(matrix, {
            min: theme.minColumnWidth,
            max: theme.maxColumnWidth,
            defaultWidth: theme.defaultColumnWidth,
          })
        : undefined,
    };
  }

  private materializeTable(
    table: SpreadsheetPlanTable,
    startColumn: number,
    plan: SpreadsheetRenderPlan,
    theme: XlsxResolvedTheme,
  ): MaterializedTable {
    const matrix: XlsxCellRuntime[][] = [];
    const structuredColumns = table.columns ?? [];
    const columnCount = this.resolveTableColumnCount(table);
    let headerRowOffset: number | undefined;

    if (table.title) {
      matrix.push([
        this.normalizeCell({
          value: table.title,
          type: 'text',
          style: {
            bold: true,
            fontSize: Math.max(theme.fontSize + 3, 14),
            align: 'center',
            color: theme.primaryColor,
            ...(table.styles?.title ?? {}),
          },
          colSpan: columnCount,
        }),
      ]);
    }

    if (table.matrix) {
      const bodyMatrix = this.normalizeMatrix(table.matrix, table.styles?.body);
      if (table.showHeader !== false && bodyMatrix.length > 0) {
        headerRowOffset = matrix.length;
        bodyMatrix[0] = bodyMatrix[0].map((cell) => ({
          ...cell,
          style: {
            bold: true,
            align: 'center',
            wrapText: true,
            fill: theme.headerFill,
            color: theme.textColor,
            border: true,
            ...(table.styles?.header ?? {}),
            ...(cell.style ?? {}),
          },
        }));
      }
      matrix.push(...bodyMatrix);
    } else {
      const columns = structuredColumns;
      if (table.showHeader !== false) {
        headerRowOffset = matrix.length;
        matrix.push(columns.map((column) => this.normalizeCell({
          value: column.header,
          type: 'text',
          width: column.width,
          style: {
            bold: true,
            align: 'center',
            wrapText: true,
            fill: theme.headerFill,
            color: theme.textColor,
            border: true,
            ...(table.styles?.header ?? {}),
            ...(column.headerStyle ?? {}),
          },
        })));
      }

      (table.rows ?? []).forEach((row, rowIndex) => {
        matrix.push(columns.map((column) => this.normalizeColumnCell(
          row,
          column,
          {
            border: true,
            ...(table.styles?.body ?? {}),
            ...(table.striped ?? plan.design.striped) && rowIndex % 2 === 1
              ? { fill: theme.zebraFill }
              : {},
            ...(column.style ?? {}),
          },
        )));
      });

      (table.summaryRows ?? []).forEach((row) => {
        matrix.push(columns.map((column) => this.normalizeColumnCell(
          row,
          column,
          {
            bold: true,
            fill: theme.summaryFill,
            border: true,
            ...(table.styles?.summary ?? {}),
            ...(column.summaryStyle ?? {}),
          },
        )));
      });
    }

    if (table.caption) {
      matrix.push([
        this.normalizeCell({
          value: table.caption,
          type: 'text',
          style: {
            italic: true,
            align: 'center',
            color: theme.mutedColor,
            ...(table.styles?.caption ?? {}),
          },
          colSpan: columnCount,
        }),
      ]);
    }

    if (table.compact ?? plan.design.compact) {
      matrix.forEach((row, rowIndex) => {
        if (table.title && rowIndex === 0) return;
        row.forEach((cell) => {
          if (cell.height == null) cell.height = 18;
        });
      });
    }

    const laidOutMatrix = this.layoutMatrix(matrix);
    this.resolvePhysicalCellWidths(laidOutMatrix, structuredColumns, theme);
    const trailingBlocks: XlsxBlockRuntime[] = [];
    if (table.note) {
      trailingBlocks.push({
        type: 'text',
        value: table.note,
        style: { italic: true, color: theme.mutedColor },
      });
    }
    trailingBlocks.push({ type: 'spacer', rows: 1 });

    const autoFit = table.autoFit ?? plan.design.autoFit;
    return {
      block: {
        type: 'matrix',
        matrix: laidOutMatrix,
        merges: this.combineMerges(table.merges ?? [], this.inferMerges(laidOutMatrix)),
        startColumn,
        autoFilterRowOffset: (table.autoFilter ?? plan.design.autoFilter)
          ? headerRowOffset
          : undefined,
        autoFit,
        columnWidths: autoFit
          ? this.resolveTableColumnWidths(laidOutMatrix, structuredColumns, theme)
          : undefined,
        hiddenColumns: structuredColumns.flatMap((column, index) =>
          column.hidden ? [index + 1] : [],
        ),
        table:
          table.name &&
          structuredColumns.length > 0 &&
          table.showHeader !== false &&
          headerRowOffset != null
            ? {
                name: table.name,
                headerRowOffset,
                dataRowCount: (table.rows ?? []).length,
                columnNames: structuredColumns.map((column) => column.header),
              }
            : undefined,
      },
      headerRowOffset,
      trailingBlocks,
    };
  }

  private resolvePhysicalCellWidths(
    matrix: XlsxCellRuntime[][],
    columns: SpreadsheetPlanColumn[],
    theme: XlsxResolvedTheme,
  ): void {
    matrix.forEach((row) => row.forEach((cell) => {
      if (cell.width == null) return;
      const column = columns[cell.column - 1];
      const minimum = Math.max(theme.minColumnWidth, column?.minWidth ?? theme.minColumnWidth);
      const maximum = Math.min(theme.maxColumnWidth, column?.maxWidth ?? theme.maxColumnWidth);
      cell.width = Math.max(minimum, Math.min(maximum, cell.width));
    }));
  }

  private resolveTableColumnWidths(
    matrix: XlsxCellRuntime[][],
    columns: SpreadsheetPlanColumn[],
    theme: XlsxResolvedTheme,
  ): number[] {
    const widths = this.estimateMatrixWidths(matrix, {
      min: theme.minColumnWidth,
      max: theme.maxColumnWidth,
      defaultWidth: theme.defaultColumnWidth,
    });
    columns.forEach((column, index) => {
      const minimum = Math.max(theme.minColumnWidth, column.minWidth ?? theme.minColumnWidth);
      const maximum = Math.min(theme.maxColumnWidth, column.maxWidth ?? theme.maxColumnWidth);
      const preferred = column.width ?? widths[index] ?? theme.defaultColumnWidth;
      widths[index] = Math.max(minimum, Math.min(maximum, preferred));
    });
    return widths;
  }

  private normalizeColumnCell(
    row: Record<string, unknown>,
    column: SpreadsheetPlanColumn,
    style: SpreadsheetPlanCellStyle,
  ): XlsxCellRuntime {
    const resolved = resolveStructuredSpreadsheetCell({
      rawValue: this.getByPath(row, column.key),
      column,
      inheritedStyle: style,
    });

    return this.normalizeCell({
      value: resolved.value,
      formula: resolved.formula,
      cachedResult: resolved.cachedResult,
      type: resolved.type,
      width: resolved.width,
      height: resolved.height,
      style: resolved.style,
      note: resolved.note,
      hyperlink: resolved.hyperlink,
      colSpan: resolved.colSpan,
      rowSpan: resolved.rowSpan,
    });
  }

  private normalizeMatrix(
    matrix: SpreadsheetPlanMatrixRow[],
    baseStyle?: SpreadsheetPlanCellStyle,
  ): XlsxCellRuntime[][] {
    return matrix.map((row) => row.map((cell) => {
      const normalized = this.normalizeCell(cell);
      return baseStyle
        ? { ...normalized, style: { ...baseStyle, ...(normalized.style ?? {}) } }
        : normalized;
    }));
  }

  private normalizeCell(cell: SpreadsheetPlanMatrixCell): XlsxCellRuntime {
    if (this.isCellSpec(cell)) {
      const value = cell.text != null
        ? cell.text
        : cell.value != null
          ? cell.value
          : null;
      return {
        column: 1,
        value: this.runtimeValue(value),
        formula: normalizeFormula(cell.formula),
        cachedResult: cell.cachedResult ?? cell.result,
        type: cell.formula ? 'formula' : cell.type ?? this.inferType([value]),
        style: cell.style,
        note: cell.note,
        hyperlink: cell.hyperlink,
        colSpan: this.positiveInteger(cell.colSpan),
        rowSpan: this.positiveInteger(cell.rowSpan),
        width: cell.width,
        height: cell.height,
      };
    }
    return {
      column: 1,
      value: this.runtimeValue(cell),
      type: this.inferType([cell]),
      colSpan: 1,
      rowSpan: 1,
    };
  }

  private resolveTheme(plan: SpreadsheetRenderPlan): XlsxResolvedTheme {
    const design = plan.design;
    return {
      fontName: design.fontName,
      fontSize: design.fontSize,
      primaryColor: cleanHex(design.primaryColor, '1F4E79'),
      accentColor: cleanHex(design.accentColor, 'D9EAF7'),
      headerFill: cleanHex(design.headerFill, design.accentColor ?? 'D9EAF7'),
      textColor: cleanHex(design.textColor, '000000'),
      mutedColor: cleanHex(design.mutedColor, '666666'),
      borderColor: cleanHex(design.borderColor, 'D9D9D9'),
      summaryFill: cleanHex(design.summaryFill, 'F5F7FA'),
      zebraFill: cleanHex(design.zebraFill, 'F7FAFC'),
      autoFit: design.autoFit,
      wrapText: design.wrapText,
      currencySymbol: design.currencySymbol ?? '',
      minColumnWidth: design.minColumnWidth,
      maxColumnWidth: design.maxColumnWidth,
      defaultColumnWidth: design.defaultColumnWidth,
      defaultRowHeight: design.defaultRowHeight ?? (design.compact ? 18 : 22),
      page: this.resolvePage(undefined, design.page),
    };
  }

  private resolvePage(
    base: SpreadsheetPlanPage | undefined,
    override: SpreadsheetPlanPage | undefined,
  ): XlsxPageRuntime {
    const margins = { ...(base?.margins ?? {}), ...(override?.margins ?? {}) };
    return {
      paperSize: this.paperSize(override?.paperSize ?? base?.paperSize),
      orientation: override?.orientation ?? base?.orientation ?? 'portrait',
      fitToPage: override?.fitToPage ?? base?.fitToPage ?? false,
      fitToWidth: override?.fitToWidth ?? base?.fitToWidth ?? 1,
      fitToHeight: override?.fitToHeight ?? base?.fitToHeight ?? 0,
      margins: {
        left: margins.left ?? 0.35,
        right: margins.right ?? 0.35,
        top: margins.top ?? 0.55,
        bottom: margins.bottom ?? 0.55,
        header: margins.header ?? 0.3,
        footer: margins.footer ?? 0.3,
      },
      header: override?.header ?? base?.header,
      footer: override?.footer ?? base?.footer,
      showPageNumber: override?.showPageNumber ?? base?.showPageNumber ?? false,
    };
  }

  private paperSize(value: SpreadsheetPlanPage['paperSize']): number {
    switch (value) {
      case 'A3': return 8;
      case 'A5': return 11;
      case 'Letter': return 1;
      case 'Legal': return 5;
      case 'A4':
      default:
        return 9;
    }
  }

  private resolveTableColumnCount(table: SpreadsheetPlanTable): number {
    if (table.columns?.length) return table.columns.length;
    if (table.matrix?.length) {
      return Math.max(1, ...table.matrix.map((row) => row.reduce<number>(
        (sum, cell) => sum + this.cellSpan(cell),
        0,
      )));
    }
    return 1;
  }

  private resolveSheetWidth(
    sheet: SpreadsheetRenderPlan['workbook']['sheets'][number],
  ): number {
    return Math.max(1, ...sheet.blocks.map((block) => {
      if (block.type === 'text') return block.mergeAcross ?? 1;
      if (block.type === 'spacer') return 1;
      if (block.type === 'matrix') {
        return (block.startColumn ?? 1) - 1 + Math.max(
          1,
          ...block.matrix.map((row) => row.reduce<number>((sum, cell) => sum + this.cellSpan(cell), 0)),
        );
      }
      return (block.startColumn ?? 1) - 1 + this.resolveTableColumnCount(block.table);
    }));
  }

  private inferMerges(matrix: XlsxCellRuntime[][]): XlsxMergeRuntime[] {
    const merges: XlsxMergeRuntime[] = [];
    matrix.forEach((row, rowIndex) => {
      row.forEach((cell) => {
        if (cell.colSpan > 1 || cell.rowSpan > 1) {
          merges.push({
            from: this.address(rowIndex + 1, cell.column),
            to: this.address(rowIndex + cell.rowSpan, cell.column + cell.colSpan - 1),
          });
        }
      });
    });
    return merges;
  }

  private combineMerges(
    explicit: XlsxMergeRuntime[],
    inferred: XlsxMergeRuntime[],
  ): XlsxMergeRuntime[] {
    const seen = new Set<string>();
    return [...explicit, ...inferred].filter((merge) => {
      const key = `${merge.from.toUpperCase()}:${merge.to.toUpperCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private inferType(values: unknown[]): SpreadsheetPlanValueType {
    const sample = values.filter((value) => value != null && value !== '').slice(0, 50);
    if (!sample.length) return 'text';
    if (sample.every((value) => typeof value === 'number')) return 'number';
    if (sample.every((value) => typeof value === 'boolean')) return 'boolean';
    if (sample.every((value) => value instanceof Date)) return 'date';
    if (sample.every((value) => typeof value === 'object')) return 'json';
    return 'text';
  }

  private runtimeValue(value: unknown): XlsxRuntimeValue {
    if (value == null) return null;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value instanceof Date ||
      Array.isArray(value) ||
      typeof value === 'object'
    ) {
      return value as XlsxRuntimeValue;
    }
    return String(value);
  }

  private getByPath(row: Record<string, unknown>, key: string): unknown {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    if (!key.includes('.')) return row[key];
    return key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[segment];
    }, row);
  }

  private isCellSpec(value: SpreadsheetPlanMatrixCell): value is SpreadsheetPlanCell {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
    return ['kind', 'value', 'text', 'formula', 'result', 'cachedResult', 'type', 'style', 'note', 'hyperlink', 'colSpan', 'rowSpan', 'width', 'height']
      .some((key) => Object.prototype.hasOwnProperty.call(value, key));
  }

  private cellSpan(value: SpreadsheetPlanMatrixCell): number {
    return this.isCellSpec(value) ? this.positiveInteger(value.colSpan) : 1;
  }

  private positiveInteger(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : 1;
  }

  private blockRows(block: XlsxBlockRuntime): number {
    if (block.type === 'spacer') return block.rows;
    if (block.type === 'text') return 1 + (block.spacingAfter ?? 0);
    return block.matrix.length;
  }

  private maxMatrixWidth(matrix: XlsxCellRuntime[][]): number {
    return Math.max(1, ...matrix.flatMap((row) => row.map(
      (cell) => cell.column + Math.max(1, cell.colSpan) - 1,
    )));
  }

  private layoutMatrix(matrix: XlsxCellRuntime[][]): XlsxCellRuntime[][] {
    const occupied = new Map<number, Set<number>>();
    return matrix.map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      let cursor = 1;
      return row.map((cell) => {
        const rowOccupied = occupied.get(rowNumber) ?? new Set<number>();
        while (rowOccupied.has(cursor)) cursor += 1;
        const column = cursor;
        for (let targetRow = rowNumber; targetRow < rowNumber + cell.rowSpan; targetRow += 1) {
          const targetOccupied = occupied.get(targetRow) ?? new Set<number>();
          for (let targetColumn = column; targetColumn < column + cell.colSpan; targetColumn += 1) {
            targetOccupied.add(targetColumn);
          }
          occupied.set(targetRow, targetOccupied);
        }
        cursor = column + cell.colSpan;
        return { ...cell, column };
      });
    });
  }

  private cellText(cell: XlsxCellRuntime): string {
    if (cell.formula) return cell.formula;
    if (cell.value == null) return '';
    if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
    if (typeof cell.value === 'object') return JSON.stringify(cell.value);
    return String(cell.value);
  }

  private visualLength(value: string): number {
    let length = 0;
    for (const character of value) {
      length += /[\u4e00-\u9fa5]/.test(character) ? 2 : 1;
    }
    return length;
  }

  private address(row: number, column: number): string {
    return `${this.columnName(column)}${row}`;
  }

  private columnName(column: number): string {
    let output = '';
    let current = column;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      output = String.fromCharCode(65 + remainder) + output;
      current = Math.floor((current - remainder) / 26);
    }
    return output;
  }
}
