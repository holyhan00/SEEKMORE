                                                              
export type DocxBlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'image'
  | 'quote'
  | 'pageBreak'
  | 'spacer'
  | 'line';

export type DocxHorizontalAlign = 'left' | 'center' | 'right' | 'justify';
export type DocxVerticalAlign = 'top' | 'center' | 'bottom';

export interface DocxPageMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface DocxParagraphStyle {
  align?: DocxHorizontalAlign;
  alignment?: DocxHorizontalAlign;

  fontFamily?: string;
  fontSize?: number;
  fontSizePt?: number;
  color?: string;
  backgroundColor?: string;

  bold?: boolean;
  italics?: boolean;
  italic?: boolean;
  underline?: boolean;

  firstLineIndent?: number;
  firstLineIndentPt?: number;
  firstLineIndentCm?: number;
  firstLineChars?: number;
  firstLineTwips?: number;
  leftTwips?: number;
  rightTwips?: number;
  leftIndent?: number;
  leftIndentPt?: number;
  leftCm?: number;
  rightIndent?: number;
  rightIndentPt?: number;
  rightCm?: number;

  spacingBefore?: number;
  spacingBeforePt?: number;
  spacingBeforeTwips?: number;
  marginTop?: number;
  spacingAfter?: number;
  spacingAfterPt?: number;
  spacingAfterTwips?: number;
  marginBottom?: number;
  lineSpacing?: number;
  lineSpacingPt?: number;
  lineRule?: string;
  lineSpacingMultiple?: number;
  lineSpacingTwips?: number;
  keepWithNext?: boolean;
  pageBreakBefore?: boolean;

  [key: string]: unknown;
}

export interface DocxBorderSpec {
  style?: 'single' | 'double' | 'dashed' | 'dotted' | 'none';
  size?: number;
  color?: string;
}

export interface DocxCellBorderSpec {
  top?: DocxBorderSpec;
  bottom?: DocxBorderSpec;
  left?: DocxBorderSpec;
  right?: DocxBorderSpec;
}

export interface DocxTheme {
  title?: string;
  subtitle?: string;

  author?: string;
  company?: string;

  primaryColor?: string;
  accentColor?: string;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;

  fontFamily?: string;
  titleFontFamily?: string;
  headingFontFamily?: string;
  numberFontFamily?: string;

  pageSize?: 'A4' | 'LETTER';
  orientation?: 'portrait' | 'landscape';

  showPageNumber?: boolean;

  margin?: DocxPageMargin;

  defaultParagraph?: DocxParagraphStyle;

  defaultTable?: {
    striped?: boolean;
    headerBold?: boolean;
    compact?: boolean;
    borderColor?: string;
  };
}

export interface DocxTextRunSpec {
  text: string;

  bold?: boolean;
  italics?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;

  color?: string;
  size?: number;
  fontSizePt?: number;
  fontFamily?: string;

  break?: number;

  styleRef?: string;
  semanticRole?: string;
  meta?: Record<string, unknown>;
}

export interface DocxTableCellSpec {
  value?: unknown;
  text?: string;

  bold?: boolean;
  italics?: boolean;
  italic?: boolean;

  colSpan?: number;
  rowSpan?: number;

  width?: number;

  align?: DocxHorizontalAlign;
  verticalAlign?: DocxVerticalAlign;

  shading?: string;
  color?: string;

  border?: DocxCellBorderSpec;
  borders?: DocxCellBorderSpec;
  style?: DocxParagraphStyle;
  paragraphStyle?: {
    spacing?: Record<string, unknown>;
    indent?: Record<string, unknown>;
  };

  styleRef?: string;
  semanticRole?: string;
  meta?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  indent?: Record<string, unknown>;
  fontSizePt?: number;
  lineSpacingPt?: number;
}

export interface DocxTableColumnSpec {
  key: string;
  header: string;
  width?: number;
  align?: DocxHorizontalAlign;
  style?: DocxParagraphStyle;
  headerStyle?: DocxParagraphStyle;

  styleRef?: string;
  semanticRole?: string;
  meta?: Record<string, unknown>;
}

export interface DocxTableSpec {
  title?: string;

  headers?: Array<string | DocxTableCellSpec>;

  rows: Array<
    Array<unknown | DocxTableCellSpec> | Record<string, unknown>
  >;

  columns?: DocxTableColumnSpec[];

  caption?: string;

  striped?: boolean;
  compact?: boolean;

  border?: DocxCellBorderSpec;
  borders?: Record<string, unknown>;
  style?: {
    title?: DocxParagraphStyle;
    header?: DocxParagraphStyle;
    body?: DocxParagraphStyle;
    caption?: DocxParagraphStyle;
  };

  styleRef?: string;
  semanticRole?: string;
  meta?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  indent?: Record<string, unknown>;
  fontSizePt?: number;
  lineSpacingPt?: number;
}

export interface DocxImageSpec {
  dataBase64: string;

  width?: number;
  height?: number;

  alt?: string;

  caption?: string;

  align?: 'left' | 'center' | 'right';
}

export type DocxBlockBase = {
  styleRef?: string;
  semanticRole?: string;
  meta?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  indent?: Record<string, unknown>;
  fontSizePt?: number;
  lineSpacingPt?: number;
};

export type DocxBlock =
  | (DocxBlockBase & {
      type: 'heading';
      text: string;
      level?: 1 | 2 | 3 | 4 | 5 | 6;
      style?: DocxParagraphStyle;
    })
  | (DocxBlockBase & {
      type: 'paragraph';
      text?: string;
      runs?: DocxTextRunSpec[];
      align?: DocxHorizontalAlign;
      style?: DocxParagraphStyle;
    })
  | (DocxBlockBase & {
      type: 'quote';
      text: string;
      style?: DocxParagraphStyle;
    })
  | (DocxBlockBase & {
      type: 'list';
      ordered?: boolean;
      items: string[];
      style?: DocxParagraphStyle;
    })
  | (DocxBlockBase & {
      type: 'table';
      table: DocxTableSpec;
    })
  | (DocxBlockBase & {
      type: 'image';
      image: DocxImageSpec;
    })
  | (DocxBlockBase & {
      type: 'line';
      border?: DocxBorderSpec;
      spacingBefore?: number;
      spacingAfter?: number;
    })
  | (DocxBlockBase & {
      type: 'pageBreak';
    })
  | (DocxBlockBase & {
      type: 'spacer';
      size?: number;
    });

export interface NormalizedDocxTableCell {
  text: string;

  bold?: boolean;
  italics?: boolean;
  italic?: boolean;

  colSpan?: number;
  rowSpan?: number;

  width?: number;

  align?: DocxHorizontalAlign;
  verticalAlign?: DocxVerticalAlign;

  shading?: string;
  color?: string;

  border?: DocxCellBorderSpec;
  borders?: DocxCellBorderSpec;
  style?: DocxParagraphStyle;
  paragraphStyle?: {
    spacing?: Record<string, unknown>;
    indent?: Record<string, unknown>;
  };

  styleRef?: string;
  semanticRole?: string;
  meta?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  indent?: Record<string, unknown>;
  fontSizePt?: number;
  lineSpacingPt?: number;
}

export interface NormalizedDocxTable {
  title?: string;

  headers: NormalizedDocxTableCell[];

  rows: NormalizedDocxTableCell[][];

  caption?: string;

  striped?: boolean;

  compact?: boolean;

  border?: DocxCellBorderSpec;
  borders?: Record<string, unknown>;

  style?: DocxTableSpec['style'];

  styleRef?: string;
  semanticRole?: string;
  meta?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  indent?: Record<string, unknown>;
  fontSizePt?: number;
  lineSpacingPt?: number;
}

export interface DocxRenderPayload {
  [key: string]: unknown;

  title?: string;

  subtitle?: string;

  content?: string;

  markdown?: string;

  theme?: DocxTheme;

  rendererHints?: Record<string, unknown>;

  blocks?: DocxBlock[];

  tables?: DocxTableSpec[];

  meta?: Record<string, unknown>;
}