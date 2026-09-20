import type { RenderPlanBase } from '../core/render-plan.types';

export const SPREADSHEET_RENDER_PLAN_VALUE_TYPES = [
  'auto',
  'text',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'boolean',
  'formula',
  'json',
] as const;

export const SPREADSHEET_RENDER_PLAN_BLOCK_TYPES = [
  'text',
  'table',
  'matrix',
  'spacer',
] as const;

export const SPREADSHEET_PLAN_HORIZONTAL_ALIGNMENTS = [
  'left',
  'center',
  'right',
  'justify',
] as const;

export const SPREADSHEET_PLAN_VERTICAL_ALIGNMENTS = [
  'top',
  'middle',
  'bottom',
] as const;

export const SPREADSHEET_PLAN_BORDER_STYLES = [
  'thin',
  'medium',
  'thick',
  'dotted',
  'dashed',
  'double',
] as const;

export const SPREADSHEET_PLAN_PAPER_SIZES = [
  'A3',
  'A4',
  'A5',
  'Letter',
  'Legal',
] as const;

export type SpreadsheetPlanValueType =
  typeof SPREADSHEET_RENDER_PLAN_VALUE_TYPES[number];
export type SpreadsheetPlanHorizontalAlign =
  typeof SPREADSHEET_PLAN_HORIZONTAL_ALIGNMENTS[number];
export type SpreadsheetPlanVerticalAlign =
  typeof SPREADSHEET_PLAN_VERTICAL_ALIGNMENTS[number];
export type SpreadsheetPlanBorderStyle =
  typeof SPREADSHEET_PLAN_BORDER_STYLES[number];
export type SpreadsheetPlanPaperSize =
  typeof SPREADSHEET_PLAN_PAPER_SIZES[number];

export type SpreadsheetPlanPrimitive = string | number | boolean | null;
export type SpreadsheetPlanCellValue =
  | SpreadsheetPlanPrimitive
  | Record<string, unknown>
  | unknown[];

export interface SpreadsheetPlanBorderEdge {
  style?: SpreadsheetPlanBorderStyle;
  color?: string;
}

export interface SpreadsheetPlanCellBorder {
  top?: SpreadsheetPlanBorderEdge;
  left?: SpreadsheetPlanBorderEdge;
  bottom?: SpreadsheetPlanBorderEdge;
  right?: SpreadsheetPlanBorderEdge;
}

export interface SpreadsheetPlanCellStyle {
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fill?: string;
  numFmt?: string;
  align?: SpreadsheetPlanHorizontalAlign;
  verticalAlign?: SpreadsheetPlanVerticalAlign;
  wrapText?: boolean;
  border?: SpreadsheetPlanCellBorder | boolean;
}

export interface SpreadsheetPlanCell {
  kind?: 'value' | 'formula';
  value?: SpreadsheetPlanCellValue;
  text?: string;
  formula?: string;
                                      
  result?: SpreadsheetPlanPrimitive;
  cachedResult?: SpreadsheetPlanPrimitive;
  type?: SpreadsheetPlanValueType;
  style?: SpreadsheetPlanCellStyle;
  note?: string;
  hyperlink?: string;
  colSpan?: number;
  rowSpan?: number;
  width?: number;
  height?: number;
}

export type SpreadsheetPlanMatrixCell = SpreadsheetPlanCellValue | SpreadsheetPlanCell;
export type SpreadsheetPlanMatrixRow = SpreadsheetPlanMatrixCell[];

export interface SpreadsheetPlanColumn {
  key: string;
  header: string;
  type?: SpreadsheetPlanValueType;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  formula?: string;
  style?: SpreadsheetPlanCellStyle;
  headerStyle?: SpreadsheetPlanCellStyle;
  summaryStyle?: SpreadsheetPlanCellStyle;
  hidden?: boolean;
}

export interface SpreadsheetPlanMergeRange {
  from: string;
  to: string;
}

export interface SpreadsheetPlanTableStyles {
  title?: SpreadsheetPlanCellStyle;
  header?: SpreadsheetPlanCellStyle;
  body?: SpreadsheetPlanCellStyle;
  summary?: SpreadsheetPlanCellStyle;
  caption?: SpreadsheetPlanCellStyle;
}

export interface SpreadsheetPlanTable {
  name?: string;
  title?: string;
  caption?: string;
  columns?: SpreadsheetPlanColumn[];
  rows?: Array<Record<string, unknown>>;
  summaryRows?: Array<Record<string, unknown>>;
  matrix?: SpreadsheetPlanMatrixRow[];
  merges?: SpreadsheetPlanMergeRange[];
  showHeader?: boolean;
  autoFilter?: boolean;
  freezeHeader?: boolean;
  striped?: boolean;
  compact?: boolean;
  autoFit?: boolean;
  note?: string;
  styles?: SpreadsheetPlanTableStyles;
}

export type SpreadsheetPlanBlock =
  | {
      type: 'text';
      value: string;
      style?: SpreadsheetPlanCellStyle;
      mergeAcross?: number;
      height?: number;
      spacingAfter?: number;
    }
  | {
      type: 'table';
      table: SpreadsheetPlanTable;
      startColumn?: number;
    }
  | {
      type: 'matrix';
      matrix: SpreadsheetPlanMatrixRow[];
      merges?: SpreadsheetPlanMergeRange[];
      startColumn?: number;
      style?: SpreadsheetPlanCellStyle;
    }
  | {
      type: 'spacer';
      rows?: number;
    };

export interface SpreadsheetPlanFreeze {
  row?: number;
  column?: number;
}

export interface SpreadsheetPlanPageMargins {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  header?: number;
  footer?: number;
}

export interface SpreadsheetPlanPage {
  paperSize?: SpreadsheetPlanPaperSize;
  orientation?: 'portrait' | 'landscape';
  fitToPage?: boolean;
  fitToWidth?: number;
  fitToHeight?: number;
  margins?: SpreadsheetPlanPageMargins;
  header?: string;
  footer?: string;
  showPageNumber?: boolean;
}

export interface SpreadsheetPlanSheet {
  name: string;
  title?: string;
  subtitle?: string;
  purpose?: string;
  blocks: SpreadsheetPlanBlock[];
  freeze?: SpreadsheetPlanFreeze;
  page?: SpreadsheetPlanPage;
}

export interface SpreadsheetPlanDesign extends Record<string, unknown> {
  intent?: string;
  fontName: string;
  fontSize: number;
  primaryColor?: string;
  accentColor?: string;
  headerFill?: string;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  summaryFill?: string;
  zebraFill?: string;
  freezeHeader: boolean;
  autoFilter: boolean;
  autoFit: boolean;
  striped: boolean;
  compact: boolean;
  wrapText: boolean;
  currencySymbol?: string;
  defaultColumnWidth: number;
  minColumnWidth: number;
  maxColumnWidth: number;
  defaultRowHeight?: number;
  page?: SpreadsheetPlanPage;
}

export interface SpreadsheetRenderPlan extends RenderPlanBase {
  [key: string]: unknown;
  kind: 'spreadsheet';
  workbook: {
    title: string;
    subtitle?: string;
    sheets: SpreadsheetPlanSheet[];
  };
  design: SpreadsheetPlanDesign;
  output: {
    format: 'xlsx';
    filename: string;
  };
}
