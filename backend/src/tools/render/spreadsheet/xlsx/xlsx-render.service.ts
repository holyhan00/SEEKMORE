import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { RenderArtifact, RenderRequest } from '../../render.types';
import { buildSpreadsheetPreview } from '../../preview/render-preview.builder';
import type {
  SpreadsheetPlanBorderEdge,
  SpreadsheetPlanCellStyle,
  SpreadsheetPlanValueType,
} from '../../planning/spreadsheet/spreadsheet-render-plan.types';
import type {
  XlsxBlockRuntime,
  XlsxCellRuntime,
  XlsxMatrixBlockRuntime,
  XlsxResolvedTheme,
  XlsxWorkbookRuntime,
} from './xlsx-runtime.types';

@Injectable()
export class XlsxRenderService {
  private readonly logger = new Logger(XlsxRenderService.name);

  async render(
    request: RenderRequest<XlsxWorkbookRuntime>,
  ): Promise<RenderArtifact> {
    const runtime = request.payload;
    this.logger.log(
      `[XlsxRender] render start title=${runtime.title || request.title || '-'} sheets=${runtime.sheets.length}`,
    );

    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;

    for (const sheet of runtime.sheets) {
      const worksheet = workbook.addWorksheet(sheet.name, {
        properties: {
          defaultRowHeight: runtime.theme.defaultRowHeight,
          defaultColWidth: runtime.theme.defaultColumnWidth,
        },
        pageSetup: {
          paperSize: sheet.page.paperSize,
          orientation: sheet.page.orientation,
          fitToPage: sheet.page.fitToPage,
          fitToWidth: sheet.page.fitToWidth,
          fitToHeight: sheet.page.fitToHeight,
          margins: sheet.page.margins,
        },
      });

      const headerFooter = this.resolveHeaderFooter(sheet.page);
      if (headerFooter) worksheet.headerFooter = headerFooter;

      if (sheet.freeze.row > 0 || sheet.freeze.column > 0) {
        worksheet.views = [{
          state: 'frozen',
          ySplit: sheet.freeze.row,
          xSplit: sheet.freeze.column,
        }];
      }

      this.renderBlocks(worksheet, sheet.blocks, runtime.theme);
      this.applyWorksheetDefaults(worksheet, runtime.theme);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = this.safeFilename(
      request.filename || `${runtime.title || request.title || 'workbook'}.xlsx`,
    );

    return {
      buffer,
      filename,
      extension: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      userId: request.userId,
      conversationId: request.conversationId,
      requestId: request.requestId,
      source: request.source ?? 'agent',
      category: 'spreadsheet',
      renderer: 'xlsx-render.service',
      rendererVersion: '4.0.0',
      preview: buildSpreadsheetPreview(runtime),
      meta: {
        ...request.meta,
        title: runtime.title || request.title,
        sheetCount: runtime.sheets.length,
      },
    };
  }

  private renderBlocks(
    worksheet: ExcelJS.Worksheet,
    blocks: XlsxBlockRuntime[],
    theme: XlsxResolvedTheme,
  ): void {
    for (const block of blocks) {
      if (block.type === 'spacer') {
        for (let index = 0; index < block.rows; index += 1) {
          worksheet.addRow([]);
        }
        continue;
      }

      if (block.type === 'text') {
        const row = worksheet.addRow([block.value]);
        row.height = block.height ?? (block.style?.fontSize ? block.style.fontSize + 10 : 24);
        this.applyStyle(row.getCell(1), {
          fontName: theme.fontName,
          fontSize: theme.fontSize,
          color: theme.textColor,
          wrapText: true,
          ...(block.style ?? {}),
        });
        if (block.mergeAcross && block.mergeAcross > 1) {
          worksheet.mergeCells(row.number, 1, row.number, block.mergeAcross);
        }
        for (let index = 0; index < (block.spacingAfter ?? 0); index += 1) {
          worksheet.addRow([]);
        }
        continue;
      }

      this.renderMatrix(worksheet, block, theme);
    }
  }

  private renderMatrix(
    worksheet: ExcelJS.Worksheet,
    block: XlsxMatrixBlockRuntime,
    theme: XlsxResolvedTheme,
  ): void {
    const startRow = worksheet.rowCount + 1;
    const maximumColumns = this.maxMatrixWidth(block.matrix);

    block.matrix.forEach((row, rowIndex) => {
      const excelRow = worksheet.addRow([]);
      const declaredHeight = row
        .map((cell) => cell.height)
        .find((height): height is number => typeof height === 'number' && height > 0);
      if (declaredHeight) excelRow.height = declaredHeight;

      row.forEach((cellRuntime) => {
        const columnNumber = block.startColumn + cellRuntime.column - 1;
        const cell = excelRow.getCell(columnNumber);
        this.assignCellValue(cell, cellRuntime);
        this.applyStyle(cell, {
          fontName: theme.fontName,
          fontSize: theme.fontSize,
          color: theme.textColor,
          wrapText: theme.wrapText,
          border: true,
          ...(cellRuntime.style ?? {}),
        });
        if (!cellRuntime.style?.numFmt) {
          this.applyTypeNumFmt(cell, cellRuntime.type, theme.currencySymbol);
        }
        if (cellRuntime.note) cell.note = cellRuntime.note;
        if (cellRuntime.width) {
          this.applyColumnWidth(
            worksheet,
            columnNumber,
            cellRuntime.width,
            theme,
          );
        }
      });

      this.logger.debug(
        `[XlsxRender] row=${startRow + rowIndex} cells=${row.length}`,
      );
    });

    for (const merge of block.merges) {
      const from = this.shiftAddress(merge.from, startRow - 1, block.startColumn - 1);
      const to = this.shiftAddress(merge.to, startRow - 1, block.startColumn - 1);
      worksheet.mergeCells(`${from}:${to}`);
    }

    if (!block.table && block.autoFilterRowOffset != null && block.matrix.length > block.autoFilterRowOffset) {
      const filterRow = startRow + block.autoFilterRowOffset;
      worksheet.autoFilter = {
        from: { row: filterRow, column: block.startColumn },
        to: {
          row: filterRow,
          column: block.startColumn + maximumColumns - 1,
        },
      };
    }

    if (block.table) {
      this.addStructuredTable(
        worksheet,
        block,
        startRow,
        theme,
      );
    }

    for (const relativeColumn of block.hiddenColumns ?? []) {
      worksheet.getColumn(block.startColumn + relativeColumn - 1).hidden = true;
    }

    if (block.autoFit && block.columnWidths) {
      block.columnWidths.forEach((width, index) => {
        this.applyColumnWidth(
          worksheet,
          block.startColumn + index,
          width,
          theme,
        );
      });
    }
  }

  private addStructuredTable(
    worksheet: ExcelJS.Worksheet,
    block: XlsxMatrixBlockRuntime,
    startRow: number,
    theme: XlsxResolvedTheme,
  ): void {
    const table = block.table;
    if (!table) return;

    const headerRow = startRow + table.headerRowOffset;
    const dataStartOffset = table.headerRowOffset + 1;
    const dataRows = block.matrix
      .slice(dataStartOffset, dataStartOffset + table.dataRowCount)
      .map((row) => table.columnNames.map((_, columnIndex) => {
        const runtime = row.find((cell) => cell.column === columnIndex + 1);
        return runtime ? this.toTableValue(runtime) : null;
      }));

    worksheet.addTable({
      name: table.name,
      ref: this.cellAddress(headerRow, block.startColumn),
      headerRow: true,
      totalsRow: false,
      style: {
        theme: 'TableStyleMedium2',
        showRowStripes: false,
        showFirstColumn: false,
        showLastColumn: false,
      },
      columns: table.columnNames.map((name) => ({ name })),
      rows: dataRows,
    });

                                                                         
                                                                            
                                                                         
    block.matrix.forEach((row, rowIndex) => {
      const excelRow = worksheet.getRow(startRow + rowIndex);
      row.forEach((runtime) => {
        const cell = excelRow.getCell(block.startColumn + runtime.column - 1);
        this.assignCellValue(cell, runtime);
        this.applyStyle(cell, {
          fontName: theme.fontName,
          fontSize: theme.fontSize,
          color: theme.textColor,
          wrapText: theme.wrapText,
          border: true,
          ...(runtime.style ?? {}),
        });
        if (!runtime.style?.numFmt) {
          this.applyTypeNumFmt(cell, runtime.type, theme.currencySymbol);
        }
      });
    });
  }

  private toTableValue(runtime: XlsxCellRuntime): ExcelJS.CellValue {
    if (runtime.formula) {
      return {
        formula: runtime.formula.replace(/^=/, ''),
        ...(runtime.cachedResult !== undefined
          ? { result: runtime.cachedResult }
          : {}),
      } as ExcelJS.CellValue;
    }
    return this.toExcelValue(runtime.value, runtime.type);
  }

  private cellAddress(row: number, column: number): string {
    let value = column;
    let letters = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      letters = String.fromCharCode(65 + remainder) + letters;
      value = Math.floor((value - 1) / 26);
    }
    return `${letters}${row}`;
  }

  private applyColumnWidth(
    worksheet: ExcelJS.Worksheet,
    columnNumber: number,
    requestedWidth: number,
    theme: XlsxResolvedTheme,
  ): void {
    const column = worksheet.getColumn(columnNumber);
    const resolvedWidth = this.clamp(
      requestedWidth,
      theme.minColumnWidth,
      theme.maxColumnWidth,
    );
    const currentWidth = typeof column.width === 'number' ? column.width : 0;

                                                                             
                                                                             
                                                      
    column.width = Math.max(currentWidth, resolvedWidth);
  }

  private assignCellValue(cell: ExcelJS.Cell, runtime: XlsxCellRuntime): void {
    if (runtime.formula) {
      const value: { formula: string; result?: string | number | boolean | Date } = {
        formula: runtime.formula.replace(/^=/, ''),
      };
      if (
        runtime.cachedResult != null &&
        (
          typeof runtime.cachedResult === 'string' ||
          typeof runtime.cachedResult === 'number' ||
          typeof runtime.cachedResult === 'boolean' ||
          runtime.cachedResult instanceof Date
        )
      ) {
        value.result = runtime.cachedResult;
      }
      cell.value = value;
      return;
    }

    if (runtime.hyperlink) {
      cell.value = {
        text: this.toDisplayValue(runtime.value),
        hyperlink: runtime.hyperlink,
      };
      return;
    }

    cell.value = this.toExcelValue(runtime.value, runtime.type);
  }

  private toExcelValue(
    value: unknown,
    type: SpreadsheetPlanValueType,
  ): ExcelJS.CellValue {
    if (value == null) return null;
    if (value instanceof Date) return value;

    if (type === 'date' || type === 'datetime') {
      if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date;
      }
    }

    if (type === 'percent' && typeof value === 'string') {
      const match = /^(-?\d+(?:\.\d+)?)%$/.exec(value.trim());
      if (match) return Number(match[1]) / 100;
    }

    if ((type === 'number' || type === 'currency') && typeof value === 'string') {
      const parsed = Number(value.replace(/[¥￥$,，\s]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (type === 'json') {
      return JSON.stringify(value);
    }

    throw new Error(
      'Structured object reached XLSX writer without an explicit json cell type.',
    );
  }

  private applyStyle(cell: ExcelJS.Cell, style: SpreadsheetPlanCellStyle): void {
    cell.font = {
      name: style.fontName,
      size: style.fontSize,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strike: style.strike,
      color: style.color ? { argb: this.argb(style.color) } : undefined,
    };
    cell.alignment = {
      horizontal: this.horizontal(style.align),
      vertical: this.vertical(style.verticalAlign),
      wrapText: style.wrapText,
    };
    if (style.fill) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: this.argb(style.fill) },
      };
    }
    if (style.numFmt) cell.numFmt = style.numFmt;

    if (style.border) {
      cell.border = typeof style.border === 'boolean'
        ? this.thinBorder()
        : {
            top: this.borderEdge(style.border.top),
            left: this.borderEdge(style.border.left),
            bottom: this.borderEdge(style.border.bottom),
            right: this.borderEdge(style.border.right),
          };
    }
  }

  private borderEdge(
    edge: SpreadsheetPlanBorderEdge | undefined,
  ): Partial<ExcelJS.Border> | undefined {
    if (!edge) return undefined;

    const borderStyle: ExcelJS.BorderStyle = edge.style ?? 'thin';
    return {
      style: borderStyle,
      color: { argb: this.argb(edge.color ?? 'D9D9D9') },
    };
  }

  private applyTypeNumFmt(
    cell: ExcelJS.Cell,
    type: SpreadsheetPlanValueType,
    currencySymbol: string,
  ): void {
    if (type === 'currency') {
      cell.numFmt = `${currencySymbol || ''}#,##0.00`;
      return;
    }
    if (type === 'percent') {
      cell.numFmt = '0.00%';
      return;
    }
    if (type === 'date') {
      cell.numFmt = 'yyyy-mm-dd';
      return;
    }
    if (type === 'datetime') {
      cell.numFmt = 'yyyy-mm-dd hh:mm';
      return;
    }
    if (type === 'number') cell.numFmt = '#,##0.00';
  }

  private applyWorksheetDefaults(
    worksheet: ExcelJS.Worksheet,
    theme: XlsxResolvedTheme,
  ): void {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (!cell.font?.name) {
          cell.font = {
            ...cell.font,
            name: theme.fontName,
            size: cell.font?.size ?? theme.fontSize,
            color: cell.font?.color ?? { argb: this.argb(theme.textColor) },
          };
        }
        cell.alignment = {
          vertical: cell.alignment?.vertical ?? 'middle',
          wrapText: cell.alignment?.wrapText ?? theme.wrapText,
          ...cell.alignment,
        };
      });
    });
  }

  private resolveHeaderFooter(
    page: XlsxWorkbookRuntime['sheets'][number]['page'],
  ): { oddHeader?: string; oddFooter?: string } | undefined {
    const result: { oddHeader?: string; oddFooter?: string } = {};
    if (page.header) result.oddHeader = `&C${this.toHeaderFooterText(page.header)}`;
    if (page.footer) result.oddFooter = `&C${this.toHeaderFooterText(page.footer)}`;
    else if (page.showPageNumber) result.oddFooter = '&C&P';
    return Object.keys(result).length ? result : undefined;
  }

  private toHeaderFooterText(value: string): string {
    return value
      .replace(/\{page\}/g, '&P')
      .replace(/\{pages\}|\{totalPages\}/g, '&N')
      .slice(0, 240);
  }

  private maxMatrixWidth(matrix: XlsxCellRuntime[][]): number {
    return Math.max(1, ...matrix.flatMap((row) => row.map(
      (cell) => cell.column + Math.max(1, cell.colSpan) - 1,
    )));
  }

  private resolveCellText(value: unknown): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private toDisplayValue(value: unknown): string {
    return this.resolveCellText(value);
  }

  private thinBorder(color = 'D9D9D9'): Partial<ExcelJS.Borders> {
    const argb = this.argb(color);
    const style: ExcelJS.BorderStyle = 'thin';
    return {
      top: { style, color: { argb } },
      left: { style, color: { argb } },
      bottom: { style, color: { argb } },
      right: { style, color: { argb } },
    };
  }

  private horizontal(
    value?: SpreadsheetPlanCellStyle['align'],
  ): SpreadsheetPlanCellStyle['align'] {
    return value ?? 'left';
  }

  private vertical(
    value?: SpreadsheetPlanCellStyle['verticalAlign'],
  ): SpreadsheetPlanCellStyle['verticalAlign'] {
    return value ?? 'middle';
  }

  private argb(color: string): string {
    const clean = color
      .replace(/^#/, '')
      .replace(/[^0-9a-fA-F]/g, '')
      .toUpperCase();
    if (clean.length === 8) return clean;
    if (clean.length === 6) return `FF${clean}`;
    return 'FF000000';
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  private safeFilename(filename: string): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, '_').trim();
    return clean.toLowerCase().endsWith('.xlsx')
      ? clean
      : `${clean || 'workbook'}.xlsx`;
  }

  private shiftAddress(
    address: string,
    rowOffset: number,
    columnOffset: number,
  ): string {
    const match = /^([A-Z]+)(\d+)$/i.exec(address.trim());
    if (!match) throw new Error(`Invalid XLSX merge address: ${address}`);
    const column = this.columnNumber(match[1]) + columnOffset;
    const row = Number(match[2]) + rowOffset;
    return `${this.columnName(column)}${row}`;
  }

  private columnNumber(name: string): number {
    let result = 0;
    for (const character of name.toUpperCase()) {
      result = result * 26 + character.charCodeAt(0) - 64;
    }
    return result;
  }

  private columnName(column: number): string {
    let name = '';
    let current = Math.max(1, column);
    while (current > 0) {
      const remainder = (current - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      current = Math.floor((current - remainder) / 26);
    }
    return name;
  }
}
