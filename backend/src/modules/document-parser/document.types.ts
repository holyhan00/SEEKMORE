                                                        

export type DocumentParserKind =
  | 'text'
  | 'markdown'
  | 'json'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'html'
  | 'image'
  | 'zip'
  | 'code'
  | 'csv';

export type DocumentParsePurpose =
  | 'content_material'

  | 'general';

export interface ParseDocumentInput {
  buffer: Buffer;
  objectName: string;
  mimeType?: string;
  extension?: string | null;
  source?: string;
  assetRole?: DocumentParsePurpose;
  parsePurpose?: 'knowledge' | 'template_profile' | 'example_profile';
}

export type ParsedDocumentCellType =
  | 'empty'
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'mixed';

export type ParsedDocumentSection = {
  title?: string;
  content: string;
  level?: number;
  meta?: Record<string, unknown>;
};

export type ParsedDocumentTableColumnProfile = {
  index: number;
  header: string;
  inferredType: ParsedDocumentCellType;
  nonEmptyCount: number;
  emptyCount: number;
  uniqueCount: number;
};

export type ParsedDocumentTable = {
  sheetName?: string;
  title?: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  rawRows: string[][];
  headerRowIndex: number;
  columnProfiles: ParsedDocumentTableColumnProfile[];
  meta?: Record<string, unknown>;
};

export type ParsedDocumentParagraphStyle = {
  index: number;
  textPreview: string;
  textLength: number;
  align?: 'left' | 'center' | 'right' | 'justify' | string;
  styleName?: string | null;
  fontFamily?: string | null;
  fontSizePt?: number | null;
  bold?: boolean | null;
  italic?: boolean | null;
  firstLineIndentPt?: number | null;
  firstLineIndentCm?: number | null;
  leftIndentPt?: number | null;
  rightIndentPt?: number | null;
  lineSpacingPt?: number | null;
  lineRule?: string | null;
  lineSpacingMultiple?: number | null;
  spacingBeforePt?: number | null;
  spacingAfterPt?: number | null;
  isHeading?: boolean;
  headingLevel?: number | null;
};

export type ParsedDocumentPageProfile = {
  widthTwip?: number | null;
  heightTwip?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  marginTopTwip?: number | null;
  marginBottomTwip?: number | null;
  marginLeftTwip?: number | null;
  marginRightTwip?: number | null;
  marginTopCm?: number | null;
  marginBottomCm?: number | null;
  marginLeftCm?: number | null;
  marginRightCm?: number | null;
  orientation?: 'portrait' | 'landscape' | string | null;
  paper?: 'A4' | 'LETTER' | string | null;
};

export type ParsedDocumentTableStyleProfile = {
  index: number;
  rowCount: number;
  columnCount: number;
  hasBorders?: boolean | null;
  alignment?: string | null;
};

export type ParsedDocumentStyleProfile = {
  parserVersion: string;
  source?: string;
  confidence?: number;
  page?: ParsedDocumentPageProfile;
  fonts?: {
    detectedFamilies: string[];
    dominantFontFamily?: string | null;
    dominantFontSizePt?: number | null;
    titleFontFamily?: string | null;
    headingFontFamily?: string | null;
    bodyFontFamily?: string | null;
    numberFontFamily?: string | null;
    fontFamily?: string | null;
    fontSizePt?: number | null;
    titleFontSizePt?: number | null;
  };
  paragraphs?: ParsedDocumentParagraphStyle[];
  paragraphSummary?: {
    total: number;
    alignments: Record<string, number>;
    fontFamilies: Record<string, number>;
    fontSizes: Record<string, number>;
    firstLineIndentPt?: number | null;
    firstLineIndentCm?: number | null;
    lineSpacingPt?: number | null;
    lineRules?: Record<string, number>;
    lineSpacingMultiple?: number | null;
    spacingBeforePt?: number | null;
    spacingAfterPt?: number | null;
  };
  tables?: ParsedDocumentTableStyleProfile[];
  drawings?: Record<string, unknown>;
  pageNumber?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export interface ParsedDocument {
  text: string;
  title?: string;
  kind: DocumentParserKind;
  mimeType?: string;
  extension?: string | null;
  meta: Record<string, unknown>;
  sections?: ParsedDocumentSection[];
  tables?: ParsedDocumentTable[];
  styleProfile?: ParsedDocumentStyleProfile;
  layoutAst?: Record<string, unknown>;
  templateProfile?: Record<string, unknown>;
  rendererHints?: Record<string, unknown>;
  explicitHints?: Record<string, unknown>;
}

export interface DocumentParseSupport {
  mimeTypes: string[];
  extensions: string[];
}
