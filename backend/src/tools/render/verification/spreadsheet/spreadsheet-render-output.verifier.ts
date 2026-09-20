                                                                                          

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { RenderArtifact } from '../../render.types';
import {
  failure,
  success,
  type RenderPlanDiagnostic,
  type RenderStageResult,
} from '../../planning/core/render-plan-diagnostics.types';
import type { RenderPlanningRequest } from '../../planning/core/render-plan.types';
import type {
  SpreadsheetPlanCellStyle,
  SpreadsheetPlanValueType,
  SpreadsheetRenderPlan,
} from '../../planning/spreadsheet/spreadsheet-render-plan.types';
import { XlsxMaterializationMapper } from '../../spreadsheet/xlsx/xlsx-materialization.mapper';
import type {
  XlsxBlockRuntime,
  XlsxCellRuntime,
  XlsxResolvedTheme,
  XlsxWorksheetRuntime,
} from '../../spreadsheet/xlsx/xlsx-runtime.types';

@Injectable()
export class SpreadsheetRenderOutputVerifier {
  constructor(
    private readonly mapper: XlsxMaterializationMapper,
  ) {}

  async verify(input: {
    plan: SpreadsheetRenderPlan;
    artifact: RenderArtifact;
    request: RenderPlanningRequest;
  }): Promise<RenderStageResult<RenderArtifact>> {
    const buffer = input.artifact.buffer;

    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
      return failure([
        this.error(
          'SPREADSHEET_OUTPUT_BUFFER_MISSING',
          'Renderer returned no workbook buffer.',
        ),
      ]);
    }

    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.load(buffer as never);
    } catch (error) {
      return failure([
        this.error(
          'SPREADSHEET_OUTPUT_CONTAINER_INVALID',
          error instanceof Error
            ? error.message
            : String(error),
        ),
      ]);
    }

    try {
      const expected = this.mapper.materialize(input.plan);
      const diagnostics: RenderPlanDiagnostic[] = [];

      if (workbook.worksheets.length !== expected.sheets.length) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_SHEET_COUNT_MISMATCH',
            `Expected ${expected.sheets.length} sheets but found ${workbook.worksheets.length}.`,
          ),
        );
      }

      let populatedCells = 0;
      let actualFormulaCount = 0;
      let actualHyperlinkCount = 0;
      let actualNoteCount = 0;
      let actualStyledCellCount = 0;
      let actualTableCount = 0;

      let expectedFormulaCount = 0;
      let expectedHyperlinkCount = 0;
      let expectedNoteCount = 0;
      let expectedStyledCellCount = 0;
      let expectedTableCount = 0;

      expected.sheets.forEach((expectedSheet) => {
        const worksheet = workbook.getWorksheet(expectedSheet.name);

        if (!worksheet) {
          diagnostics.push(
            this.error(
              'SPREADSHEET_OUTPUT_SHEET_MISSING',
              `Expected sheet is missing: ${expectedSheet.name}.`,
            ),
          );
          return;
        }

        this.verifySheetStructure(
          expectedSheet,
          worksheet,
          diagnostics,
        );

        this.verifyMaterializedSheet(
          expectedSheet,
          expected.theme,
          worksheet,
          diagnostics,
        );

        const expectedCounts = this.expectedCounts(
          expectedSheet.blocks,
        );

        expectedFormulaCount += expectedCounts.formulas;
        expectedHyperlinkCount += expectedCounts.hyperlinks;
        expectedNoteCount += expectedCounts.notes;
        expectedStyledCellCount += expectedCounts.styled;
        expectedTableCount += expectedSheet.blocks.filter(
          (block) => block.type === 'matrix' && Boolean(block.table),
        ).length;
        actualTableCount += ((worksheet.model as { tables?: unknown[] }).tables ?? []).length;

        worksheet.eachRow((row) => {
          row.eachCell((cell) => {
            if (
              cell.value != null &&
              this.cellText(cell.value).trim().length > 0
            ) {
              populatedCells += 1;
            }

            if (this.hasFormula(cell.value)) {
              actualFormulaCount += 1;
            }

            if (this.hasHyperlink(cell.value)) {
              actualHyperlinkCount += 1;
            }

            if (cell.note != null) {
              actualNoteCount += 1;
            }

            if (this.hasStyle(cell)) {
              actualStyledCellCount += 1;
            }

            if (this.isLeakedCellDescriptor(cell.value)) {
              diagnostics.push(
                this.error(
                  'SPREADSHEET_OUTPUT_CELL_DESCRIPTOR_LEAKED',
                  `Serialized cell descriptor leaked into ${worksheet.name}!${cell.address}.`,
                ),
              );
            }
          });
        });
      });

      if (populatedCells === 0) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_EMPTY',
            'Workbook contains no populated cells.',
          ),
        );
      }

      if (actualFormulaCount !== expectedFormulaCount) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_FORMULA_COUNT_MISMATCH',
            `Expected ${expectedFormulaCount} formula cells but found ${actualFormulaCount}.`,
          ),
        );
      }

      if (actualTableCount !== expectedTableCount) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_TABLE_COUNT_MISMATCH',
            `Expected ${expectedTableCount} Excel tables but found ${actualTableCount}.`,
          ),
        );
      }

      if (actualHyperlinkCount !== expectedHyperlinkCount) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_HYPERLINK_COUNT_MISMATCH',
            `Expected ${expectedHyperlinkCount} hyperlinks but found ${actualHyperlinkCount}.`,
          ),
        );
      }

      if (actualNoteCount !== expectedNoteCount) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_NOTE_COUNT_MISMATCH',
            `Expected ${expectedNoteCount} notes but found ${actualNoteCount}.`,
          ),
        );
      }

      if (actualStyledCellCount < expectedStyledCellCount) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_STYLE_MISSING',
            `Expected at least ${expectedStyledCellCount} explicitly styled cells but found ${actualStyledCellCount}.`,
          ),
        );
      }

      const blockingDiagnostics = diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );

      if (blockingDiagnostics.length > 0) {
        return failure(diagnostics);
      }

      return success(
        {
          ...input.artifact,
          sizeBytes: buffer.byteLength,
        },
        [
          ...diagnostics,
          {
            stage: 'verification',
            code: 'SPREADSHEET_OUTPUT_VERIFIED',
            message:
              `Verified workbook with ${workbook.worksheets.length} sheets ` +
              `and ${populatedCells} populated cells.`,
            severity: 'info',
            repairable: false,
          },
        ],
      );
    } catch (error) {
      return failure([
        this.error(
          'SPREADSHEET_OUTPUT_VERIFIER_INTERNAL_ERROR',
          error instanceof Error
            ? error.message
            : String(error),
        ),
      ]);
    }
  }

  private verifySheetStructure(
    expectedSheet: XlsxWorksheetRuntime,
    worksheet: ExcelJS.Worksheet,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const expectedMerges = expectedSheet.blocks.reduce(
      (total, block) => {
        if (block.type === 'matrix') {
          return total + block.merges.length;
        }

        if (
          block.type === 'text' &&
          (block.mergeAcross ?? 1) > 1
        ) {
          return total + 1;
        }

        return total;
      },
      0,
    );

    const actualMerges = this.worksheetMerges(worksheet).length;

    if (actualMerges !== expectedMerges) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_MERGE_COUNT_MISMATCH',
          `Sheet ${expectedSheet.name} expected ${expectedMerges} merges but found ${actualMerges}.`,
        ),
      );
    }

    this.verifyFreezePane(
      expectedSheet,
      worksheet,
      diagnostics,
    );

    this.verifyPageSetup(
      expectedSheet,
      worksheet,
      diagnostics,
    );

    const expectedAutoFilter = expectedSheet.blocks.some(
      (block) =>
        block.type === 'matrix' &&
        block.autoFilterRowOffset != null,
    );

    const actualAutoFilter = worksheet.autoFilter != null;

    if (actualAutoFilter !== expectedAutoFilter) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_AUTOFILTER_MISMATCH',
          `Sheet ${expectedSheet.name} auto-filter state does not match the plan.`,
        ),
      );
    }
  }

  private verifyFreezePane(
    expectedSheet: XlsxWorksheetRuntime,
    worksheet: ExcelJS.Worksheet,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const expectedFreeze = expectedSheet.freeze;

    const worksheetViews = Array.isArray(worksheet.views)
      ? worksheet.views
      : [];

    const frozenView = worksheetViews.find(
      (view) => view?.state === 'frozen',
    );

    const actualFreezeRow =
      frozenView &&
      'ySplit' in frozenView &&
      typeof frozenView.ySplit === 'number'
        ? frozenView.ySplit
        : 0;

    const actualFreezeColumn =
      frozenView &&
      'xSplit' in frozenView &&
      typeof frozenView.xSplit === 'number'
        ? frozenView.xSplit
        : 0;

    if (
      actualFreezeRow !== expectedFreeze.row ||
      actualFreezeColumn !== expectedFreeze.column
    ) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_FREEZE_MISMATCH',
          `Sheet ${expectedSheet.name} freeze pane does not match the plan.`,
        ),
      );
    }
  }

  private verifyPageSetup(
    expectedSheet: XlsxWorksheetRuntime,
    worksheet: ExcelJS.Worksheet,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const pageSetup = worksheet.pageSetup ?? {};

    if (
      pageSetup.orientation !== expectedSheet.page.orientation ||
      Boolean(pageSetup.fitToPage) !==
        expectedSheet.page.fitToPage ||
      Number(pageSetup.fitToWidth ?? 0) !==
        expectedSheet.page.fitToWidth ||
      Number(pageSetup.fitToHeight ?? 0) !==
        expectedSheet.page.fitToHeight
    ) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_PAGE_SETUP_MISMATCH',
          `Sheet ${expectedSheet.name} page setup does not match the materialized plan.`,
        ),
      );
    }
  }

  private verifyMaterializedSheet(
    expected: XlsxWorksheetRuntime,
    theme: XlsxResolvedTheme,
    worksheet: ExcelJS.Worksheet,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const pageSetup = worksheet.pageSetup ?? {};

    if (pageSetup.paperSize !== expected.page.paperSize) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_PAPER_SIZE_MISMATCH',
          `Sheet ${expected.name} paper size does not match the materialized plan.`,
        ),
      );
    }

    const actualMargins = pageSetup.margins;

    for (
      const key of [
        'left',
        'right',
        'top',
        'bottom',
        'header',
        'footer',
      ] as const
    ) {
      const actualValue = Number(
        actualMargins?.[key] ?? 0,
      );

      const expectedValue = Number(
        expected.page.margins[key] ?? 0,
      );

      if (
        Math.abs(actualValue - expectedValue) > 0.001
      ) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_PAGE_MARGIN_MISMATCH',
            `Sheet ${expected.name} page margin ${key} does not match the materialized plan.`,
          ),
        );
      }
    }

    this.verifyHeaderFooter(
      expected,
      worksheet,
      diagnostics,
    );

    let rowCursor = 1;

    const expectedWidths = new Map<number, number>();
    const hiddenColumns = new Set<number>();

    for (const block of expected.blocks) {
      if (block.type === 'spacer') {
        rowCursor += block.rows;
        continue;
      }

      if (block.type === 'text') {
        const cell = worksheet.getCell(rowCursor, 1);

        if (block.style) {
          this.verifyCellStyle(
            block.style,
            undefined,
            theme,
            cell,
            expected.name,
            rowCursor,
            1,
            diagnostics,
          );
        }

        rowCursor += 1 + (block.spacingAfter ?? 0);
        continue;
      }

      block.matrix.forEach((row, rowIndex) => {
        row.forEach((runtimeCell) => {
          const rowNumber = rowCursor + rowIndex;

          const columnNumber =
            block.startColumn +
            runtimeCell.column -
            1;

          const cell = worksheet.getCell(
            rowNumber,
            columnNumber,
          );

          this.verifyRuntimeCell(
            runtimeCell,
            theme,
            cell,
            expected.name,
            rowNumber,
            columnNumber,
            diagnostics,
          );

          if (runtimeCell.width != null) {
            expectedWidths.set(
              columnNumber,
              runtimeCell.width,
            );
          }
        });
      });

      block.columnWidths?.forEach((width, index) => {
        expectedWidths.set(
          block.startColumn + index,
          width,
        );
      });

      block.hiddenColumns?.forEach(
        (relativeColumn) => {
          hiddenColumns.add(
            block.startColumn +
              relativeColumn -
              1,
          );
        },
      );

      rowCursor += block.matrix.length;
    }

    for (const [columnNumber, width] of expectedWidths) {
      const actual = Number(
        worksheet.getColumn(columnNumber).width ?? 0,
      );

      if (Math.abs(actual - width) > 0.1) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_COLUMN_WIDTH_MISMATCH',
            `Sheet ${expected.name} column ${columnNumber} width does not match the materialized plan.`,
          ),
        );
      }
    }

    for (const columnNumber of hiddenColumns) {
      if (!worksheet.getColumn(columnNumber).hidden) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_HIDDEN_COLUMN_MISSING',
            `Sheet ${expected.name} column ${columnNumber} should be hidden.`,
          ),
        );
      }
    }
  }

  private verifyHeaderFooter(
    expected: XlsxWorksheetRuntime,
    worksheet: ExcelJS.Worksheet,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const expectedHeader = expected.page.header
      ? `&C${this.headerFooterText(expected.page.header)}`
      : undefined;

    const expectedFooter = expected.page.footer
      ? `&C${this.headerFooterText(expected.page.footer)}`
      : expected.page.showPageNumber
        ? '&C&P'
        : undefined;

    const headerFooter =
      worksheet.headerFooter ?? undefined;

    const actualHeader =
      headerFooter?.oddHeader || undefined;

    const actualFooter =
      headerFooter?.oddFooter || undefined;

    if (actualHeader !== expectedHeader) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_HEADER_MISMATCH',
          `Sheet ${expected.name} header does not match the materialized plan.`,
        ),
      );
    }

    if (actualFooter !== expectedFooter) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_FOOTER_MISMATCH',
          `Sheet ${expected.name} footer does not match the materialized plan.`,
        ),
      );
    }
  }

  private verifyRuntimeCell(
    expected: XlsxCellRuntime,
    theme: XlsxResolvedTheme,
    actual: ExcelJS.Cell,
    sheetName: string,
    row: number,
    column: number,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const location =
      `${sheetName}!${this.columnName(column)}${row}`;

    if (expected.formula) {
      const formula = this.formula(actual.value);

      if (
        formula !== expected.formula.replace(/^=/, '')
      ) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_FORMULA_MISMATCH',
            `Formula mismatch at ${location}.`,
          ),
        );
      }

      if (
        expected.cachedResult != null &&
        this.formulaResult(actual.value) !==
          expected.cachedResult
      ) {
        diagnostics.push(
          this.error(
            'SPREADSHEET_OUTPUT_FORMULA_RESULT_MISMATCH',
            `Formula result mismatch at ${location}.`,
          ),
        );
      }
    }

    if (
      expected.hyperlink &&
      this.hyperlink(actual.value) !==
        expected.hyperlink
    ) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_HYPERLINK_MISMATCH',
          `Hyperlink mismatch at ${location}.`,
        ),
      );
    }

    if (
      expected.note &&
      !this.noteText(actual.note).includes(
        expected.note,
      )
    ) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_NOTE_MISMATCH',
          `Note mismatch at ${location}.`,
        ),
      );
    }

    this.verifyCellStyle(
      expected.style,
      expected.type,
      theme,
      actual,
      sheetName,
      row,
      column,
      diagnostics,
    );
  }

  private verifyCellStyle(
    expected: SpreadsheetPlanCellStyle | undefined,
    type: SpreadsheetPlanValueType | undefined,
    theme: XlsxResolvedTheme,
    actual: ExcelJS.Cell,
    sheetName: string,
    row: number,
    column: number,
    diagnostics: RenderPlanDiagnostic[],
  ): void {
    const location =
      `${sheetName}!${this.columnName(column)}${row}`;

    const style = expected ?? {};

    const checks: Array<[boolean, string]> = [
      [
        style.fontName == null ||
          actual.font?.name === style.fontName,
        'font name',
      ],
      [
        style.fontSize == null ||
          actual.font?.size === style.fontSize,
        'font size',
      ],
      [
        style.bold == null ||
          Boolean(actual.font?.bold) === style.bold,
        'bold',
      ],
      [
        style.italic == null ||
          Boolean(actual.font?.italic) === style.italic,
        'italic',
      ],
      [
        style.strike == null ||
          Boolean(actual.font?.strike) === style.strike,
        'strike',
      ],
      [
        style.align == null ||
          actual.alignment?.horizontal === style.align,
        'horizontal alignment',
      ],
      [
        style.verticalAlign == null ||
          actual.alignment?.vertical ===
            style.verticalAlign,
        'vertical alignment',
      ],
      [
        style.wrapText == null ||
          Boolean(actual.alignment?.wrapText) ===
            style.wrapText,
        'wrapText',
      ],
      [
        style.color == null ||
          actual.font?.color?.argb ===
            this.argb(style.color),
        'font color',
      ],
      [
        style.fill == null ||
          this.fillColor(actual.fill) ===
            this.argb(style.fill),
        'fill',
      ],
    ];

    for (const [ok, label] of checks) {
      if (!ok) {
        const diagnostic =
          label === 'horizontal alignment' ||
          label === 'vertical alignment'
            ? this.warning(
                'SPREADSHEET_OUTPUT_CELL_STYLE_MISMATCH',
                `${label} mismatch at ${location}.`,
                {
                  sheetName,
                  row,
                  column,
                  property: label,
                },
              )
            : this.error(
                'SPREADSHEET_OUTPUT_CELL_STYLE_MISMATCH',
                `${label} mismatch at ${location}.`,
              );

        diagnostics.push(diagnostic);
      }
    }

    const expectedNumFmt =
      style.numFmt ??
      this.defaultNumFmt(
        type,
        theme.currencySymbol,
      );

    if (
      expectedNumFmt &&
      actual.numFmt !== expectedNumFmt
    ) {
      diagnostics.push(
        this.warning(
          'SPREADSHEET_OUTPUT_NUMBER_FORMAT_MISMATCH',
          `Number format mismatch at ${location}.`,
          {
            sheetName,
            row,
            column,
            expected: expectedNumFmt,
            actual: actual.numFmt,
          },
        ),
      );
    }

    if (
      style.border &&
      !actual.border?.top &&
      !actual.border?.bottom &&
      !actual.border?.left &&
      !actual.border?.right
    ) {
      diagnostics.push(
        this.error(
          'SPREADSHEET_OUTPUT_BORDER_MISSING',
          `Border is missing at ${location}.`,
        ),
      );
    }
  }

  private defaultNumFmt(
    type: SpreadsheetPlanValueType | undefined,
    currencySymbol: string,
  ): string | undefined {
    if (type === 'currency') {
      return `${currencySymbol || ''}#,##0.00`;
    }

    if (type === 'percent') {
      return '0.00%';
    }

    if (type === 'date') {
      return 'yyyy-mm-dd';
    }

    if (type === 'datetime') {
      return 'yyyy-mm-dd hh:mm';
    }

    if (type === 'number') {
      return '#,##0.00';
    }

    return undefined;
  }

  private formula(
    value: ExcelJS.CellValue,
  ): string | undefined {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('formula' in value)
    ) {
      return undefined;
    }

    return String(
      (value as { formula?: unknown }).formula ?? '',
    );
  }

  private formulaResult(
    value: ExcelJS.CellValue,
  ): unknown {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('formula' in value)
    ) {
      return undefined;
    }

    return (
      value as { result?: unknown }
    ).result;
  }

  private hyperlink(
    value: ExcelJS.CellValue,
  ): string | undefined {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('hyperlink' in value)
    ) {
      return undefined;
    }

    return String(
      (value as { hyperlink?: unknown })
        .hyperlink ?? '',
    );
  }

  private noteText(
    note: ExcelJS.Cell['note'],
  ): string {
    if (!note) {
      return '';
    }

    if (typeof note === 'string') {
      return note;
    }

    const texts = (
      note as {
        texts?: Array<{
          text?: unknown;
        }>;
      }
    ).texts;

    if (Array.isArray(texts)) {
      return texts
        .map((entry) =>
          String(entry?.text ?? ''),
        )
        .join('');
    }

    try {
      return JSON.stringify(note);
    } catch {
      return String(note);
    }
  }

  private fillColor(
    fill: ExcelJS.Cell['fill'],
  ): string | undefined {
    if (
      !fill ||
      fill.type !== 'pattern'
    ) {
      return undefined;
    }

    return fill.fgColor?.argb;
  }

  private headerFooterText(
    value: string,
  ): string {
    return value
      .replace(/\{page\}/g, '&P')
      .replace(
        /\{pages\}|\{totalPages\}/g,
        '&N',
      )
      .slice(0, 240);
  }

  private argb(color: string): string {
    const clean = color
      .replace(/^#/, '')
      .replace(
        /[^0-9a-fA-F]/g,
        '',
      )
      .toUpperCase();

    if (clean.length === 8) {
      return clean;
    }

    if (clean.length === 6) {
      return `FF${clean}`;
    }

    return 'FF000000';
  }

  private columnName(column: number): string {
    let output = '';
    let current = column;

    while (current > 0) {
      const remainder =
        (current - 1) % 26;

      output =
        String.fromCharCode(65 + remainder) +
        output;

      current = Math.floor(
        (current - remainder) / 26,
      );
    }

    return output;
  }

  private expectedCounts(
    blocks: XlsxBlockRuntime[],
  ): {
    formulas: number;
    hyperlinks: number;
    notes: number;
    styled: number;
  } {
    const counts = {
      formulas: 0,
      hyperlinks: 0,
      notes: 0,
      styled: 0,
    };

    for (const block of blocks) {
      if (block.type === 'text') {
        if (block.style) {
          counts.styled += 1;
        }

        continue;
      }

      if (block.type === 'spacer') {
        continue;
      }

      block.matrix.forEach((row) => {
        row.forEach((cell) => {
          if (cell.formula) {
            counts.formulas += 1;
          }

          if (cell.hyperlink) {
            counts.hyperlinks += 1;
          }

          if (cell.note) {
            counts.notes += 1;
          }

          if (cell.style) {
            counts.styled += 1;
          }
        });
      });
    }

    return counts;
  }

  private worksheetMerges(
    worksheet: ExcelJS.Worksheet,
  ): string[] {
    const model = worksheet.model as unknown as {
      merges?: unknown;
    };

    if (!Array.isArray(model?.merges)) {
      return [];
    }

    return model.merges.filter(
      (value): value is string =>
        typeof value === 'string',
    );
  }

  private isLeakedCellDescriptor(value: ExcelJS.CellValue): boolean {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return (
        typeof parsed.formula === 'string' &&
        (
          Object.prototype.hasOwnProperty.call(parsed, 'result') ||
          Object.prototype.hasOwnProperty.call(parsed, 'cachedResult') ||
          Object.prototype.hasOwnProperty.call(parsed, 'style') ||
          parsed.kind === 'formula'
        )
      );
    } catch {
      return false;
    }
  }

  private hasFormula(
    value: ExcelJS.CellValue,
  ): boolean {
    return Boolean(
      value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'formula' in value,
    );
  }

  private hasHyperlink(
    value: ExcelJS.CellValue,
  ): boolean {
    return Boolean(
      value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'hyperlink' in value,
    );
  }

  private hasStyle(
    cell: ExcelJS.Cell,
  ): boolean {
    return Boolean(
      cell.font?.bold ||
        cell.font?.italic ||
        cell.font?.strike ||
        cell.font?.color ||
        cell.fill?.type ||
        cell.border?.top ||
        cell.border?.bottom ||
        cell.border?.left ||
        cell.border?.right ||
        cell.numFmt ||
        cell.alignment?.horizontal ||
        cell.alignment?.vertical ||
        cell.alignment?.wrapText,
    );
  }

  private cellText(
    value: ExcelJS.CellValue,
  ): string {
    if (value == null) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    return String(value);
  }

  private warning(
    code: string,
    message: string,
    detail?: Record<string, unknown>,
  ): RenderPlanDiagnostic {
    return {
      stage: 'verification',
      code,
      message,
      severity: 'warning',
      repairable: true,
      ...(detail ? { detail } : {}),
    };
  }

  private error(
    code: string,
    message: string,
  ): RenderPlanDiagnostic {
    return {
      stage: 'verification',
      code,
      message,
      severity: 'error',
      repairable: false,
    };
  }
}