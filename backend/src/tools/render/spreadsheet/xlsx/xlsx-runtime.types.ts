import type {
  SpreadsheetPlanCellStyle,
  SpreadsheetPlanPage,
  SpreadsheetPlanValueType,
} from '../../planning/spreadsheet/spreadsheet-render-plan.types';

export type XlsxRuntimePrimitive = string | number | boolean | Date | null;
export type XlsxRuntimeValue =
  | XlsxRuntimePrimitive
  | Record<string, unknown>
  | unknown[];

export interface XlsxCellRuntime {
  column: number;
  value: XlsxRuntimeValue;
  formula?: string;
  cachedResult?: XlsxRuntimePrimitive;
  type: SpreadsheetPlanValueType;
  style?: SpreadsheetPlanCellStyle;
  note?: string;
  hyperlink?: string;
  colSpan: number;
  rowSpan: number;
  width?: number;
  height?: number;
}

export interface XlsxMergeRuntime {
  from: string;
  to: string;
}

export interface XlsxTextBlockRuntime {
  type: 'text';
  value: string;
  style?: SpreadsheetPlanCellStyle;
  mergeAcross?: number;
  height?: number;
  spacingAfter?: number;
}

export interface XlsxTableRuntime {
  name: string;
  headerRowOffset: number;
  dataRowCount: number;
  columnNames: string[];
}

export interface XlsxMatrixBlockRuntime {
  type: 'matrix';
  matrix: XlsxCellRuntime[][];
  merges: XlsxMergeRuntime[];
  startColumn: number;
  autoFilterRowOffset?: number;
  autoFit: boolean;
  columnWidths?: number[];
  hiddenColumns?: number[];
  table?: XlsxTableRuntime;
}

export interface XlsxSpacerBlockRuntime {
  type: 'spacer';
  rows: number;
}

export type XlsxBlockRuntime =
  | XlsxTextBlockRuntime
  | XlsxMatrixBlockRuntime
  | XlsxSpacerBlockRuntime;

export interface XlsxPageRuntime {
  paperSize: number;
  orientation: 'portrait' | 'landscape';
  fitToPage: boolean;
  fitToWidth: number;
  fitToHeight: number;
  margins: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    header: number;
    footer: number;
  };
  header?: string;
  footer?: string;
  showPageNumber: boolean;
}

export interface XlsxResolvedTheme {
  fontName: string;
  fontSize: number;
  primaryColor: string;
  accentColor: string;
  headerFill: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  summaryFill: string;
  zebraFill: string;
  autoFit: boolean;
  wrapText: boolean;
  currencySymbol: string;
  minColumnWidth: number;
  maxColumnWidth: number;
  defaultColumnWidth: number;
  defaultRowHeight: number;
  page: XlsxPageRuntime;
}

export interface XlsxWorksheetRuntime {
  name: string;
  blocks: XlsxBlockRuntime[];
  freeze: {
    row: number;
    column: number;
  };
  page: XlsxPageRuntime;
}

export interface XlsxWorkbookRuntime {
  [key: string]: unknown;
  title: string;
  subtitle?: string;
  theme: XlsxResolvedTheme;
  sheets: XlsxWorksheetRuntime[];
}

export type XlsxPageSource = SpreadsheetPlanPage | undefined;
