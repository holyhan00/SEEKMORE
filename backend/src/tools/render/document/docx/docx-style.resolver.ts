                                                                

import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  LineRuleType,
  PageNumber,
  Paragraph,
  ShadingType,
  TextRun,
  WidthType,
} from 'docx';
import { DocxRenderPayload, NormalizedDocxTableCell } from './docx-render.types';

export type DocxThemeRuntime = {
  primaryColor: string;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  fontFamily: string;
  titleFontFamily: string;
  headingFontFamily: string;
  numberFontFamily: string;
  stripedTables: boolean;
  compactTables: boolean;
  tableBorderSize?: number;
  tableBorderStyle?: string;
  paragraphLineSpacing?: number;
  paragraphLineRule?: (typeof LineRuleType)[keyof typeof LineRuleType];
  paragraphSpacingAfter?: number;
  paragraphFirstLineIndent?: number;
  paragraphHangingIndent?: number;
  defaultFontSize?: number;
  defaultHeadingFontSize?: number;
  defaultTitleFontSize?: number;
  defaultParagraphAlign?: 'left' | 'center' | 'right' | 'justify';
  tableCellMargin?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
};

export type DocxRendererHints = {
  page?: {
    marginTopCm?: number;
    marginBottomCm?: number;
    marginLeftCm?: number;
    marginRightCm?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    paper?: string;
    pageSize?: string;
    orientation?: 'portrait' | 'landscape' | string;
  };
  paragraph?: {
    lineSpacingPt?: number;
    lineRule?:
      | 'single'
      | '1.5'
      | 'double'
      | 'multiple'
      | 'exact'
      | 'atLeast'
      | string;
    lineRules?: Record<string, number>;
    lineSpacingMultiple?: number;
    lineSpacingTwips?: number;
    spacingBeforeTwips?: number;
    spacingAfterTwips?: number;
    firstLineTwips?: number;
    spacingAfter?: number;
    spacingBefore?: number;
    firstLineIndentCm?: number;
    firstLineIndent?: number;
    hangingIndentCm?: number;
    hangingIndent?: number;
    align?: 'left' | 'center' | 'right' | 'justify';
    fontSizePt?: number;
  };
  fonts?: {
    fontFamily?: string;
    bodyFontFamily?: string;
    titleFontFamily?: string;
    headingFontFamily?: string;
    numberFontFamily?: string;
    dominantFontFamily?: string;
    dominantFontSizePt?: number;
    fontSizePt?: number;
    titleFontSizePt?: number;
    headingFontSizePt?: number;
  };
  table?: {
    borderColor?: string;
    borderSize?: number;
    borderStyle?: string;
    compact?: boolean;
    striped?: boolean;
    cellMarginTop?: number;
    cellMarginBottom?: number;
    cellMarginLeft?: number;
    cellMarginRight?: number;
  };
  header?: {
    text?: string;
    align?: 'left' | 'center' | 'right';
  };
  footer?: {
    text?: string;
    align?: 'left' | 'center' | 'right';
    showPageNumber?: boolean;
    fontFamily?: string;
    fontSizePt?: number;
  };
  namedStyles?: Record<string, Record<string, unknown>>;
};

@Injectable()
export class DocxStyleResolver {
  extractRendererHints(payload: DocxRenderPayload): DocxRendererHints {
    const direct = (payload as any)?.rendererHints;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as DocxRendererHints;
    }

    const fromMeta = (payload as any)?.meta?.rendererHints;
    if (fromMeta && typeof fromMeta === 'object' && !Array.isArray(fromMeta)) {
      return fromMeta as DocxRendererHints;
    }

    return {};
  }

  resolveNamedStyles(rendererHints: DocxRendererHints): Record<string, Record<string, unknown>> {
    return this.asRecord(rendererHints.namedStyles) as Record<string, Record<string, unknown>>;
  }

  resolveBlockStyle(input: {
    block: Record<string, unknown>;
    rendererHints: DocxRendererHints;
    theme?: DocxThemeRuntime;
  }): Record<string, unknown> {
    const block = input.block;
    const namedStyles = this.resolveNamedStyles(input.rendererHints);
    const blockStyle = this.asRecord(block.style);
    const explicitStyleRef = this.firstString(
      (block as any).styleRef,
      this.asRecord(block.meta).styleRef,
    );

    const styleRef = explicitStyleRef ?? this.inferBlockStyleRef(block);
    const namedStyle = styleRef ? this.asRecord(namedStyles[styleRef]) : {};

    return this.normalizeResolvedBlockStyle(
      this.mergeStyleRecords(namedStyle, blockStyle),
      input.theme,
    );
  }

  buildTheme(
    themePayload: DocxRenderPayload['theme'],
    rendererHints: DocxRendererHints,
  ): DocxThemeRuntime {
    const theme = themePayload ?? {};

    const namedStyles = this.resolveNamedStyles(rendererHints);
    const bodyStyle = this.asRecord(namedStyles.body);
    const titleStyle = this.asRecord(namedStyles.title);
    const headingStyle = this.asRecord(namedStyles.heading);

    const fonts = this.asRecord(rendererHints.fonts);
    const paragraph = this.mergeStyleRecords(
      this.asRecord(rendererHints.paragraph),
      bodyStyle,
    );
    const table = this.asRecord(rendererHints.table);

    const bodyFontFamily =
      this.firstString(
        bodyStyle.fontFamily,
        fonts.fontFamily,
        fonts.bodyFontFamily,
        fonts.body,
        fonts.dominantFontFamily,
        (theme as any).fontFamily,
) || this.firstString((theme as any).fontFamily) || 'Arial';

    const titleFontFamily =
      this.firstString(
        titleStyle.fontFamily,
        fonts.titleFontFamily,
        fonts.title,
        (theme as any).titleFontFamily,
        bodyFontFamily,
      ) || bodyFontFamily;

    const headingFontFamily =
      this.firstString(
        headingStyle.fontFamily,
        fonts.headingFontFamily,
        fonts.heading,
        (theme as any).headingFontFamily,
        bodyFontFamily,
      ) || bodyFontFamily;

    const numberFontFamily =
      this.firstString(
        fonts.numberFontFamily,
        fonts.number,
        (theme as any).numberFontFamily,
) || bodyFontFamily;

    return {
      primaryColor: this.cleanColor(theme.primaryColor || theme.textColor || '000000'),
      accentColor: this.cleanColor(theme.accentColor || ''),
      textColor: this.cleanColor(theme.textColor || '000000'),
      mutedColor: this.cleanColor(theme.mutedColor || theme.textColor || '000000'),
      borderColor: this.cleanColor(table.borderColor || theme.borderColor || '000000'),
      fontFamily: bodyFontFamily,
      titleFontFamily,
      headingFontFamily,
      numberFontFamily,
      stripedTables: table.striped ?? theme.defaultTable?.striped ?? false,
      compactTables: table.compact ?? theme.defaultTable?.compact ?? false,
      tableBorderSize: this.numberOrUndefined(table.borderSize),
      tableBorderStyle: this.firstString(table.borderStyle),
      paragraphLineSpacing: this.resolveLineSpacing(paragraph),
      paragraphLineRule: this.resolveLineRule(paragraph.lineRule),
      paragraphSpacingAfter: this.resolveSpacingAfter(rendererHints),
      paragraphFirstLineIndent: this.resolveFirstLineIndent(rendererHints),
      paragraphHangingIndent: this.resolveHangingIndent(rendererHints),
      defaultFontSize: this.resolveFontSizePt(
        this.numberOrUndefined(paragraph.fontSizePt),
        this.numberOrUndefined(bodyStyle.fontSizePt) ??
          this.numberOrUndefined(fonts.fontSizePt) ??
          this.numberOrUndefined(fonts.dominantFontSizePt) ??
          this.numberOrUndefined((theme as any).fontSizePt),
      ),
      defaultHeadingFontSize: this.resolveFontSizePt(
        this.numberOrUndefined(headingStyle.fontSizePt),
        this.numberOrUndefined(fonts.headingFontSizePt),
      ),
      defaultTitleFontSize: this.resolveFontSizePt(
        this.numberOrUndefined(titleStyle.fontSizePt),
        this.numberOrUndefined(fonts.titleFontSizePt),
      ),
      defaultParagraphAlign: this.safeParagraphAlign(paragraph.align),
      tableCellMargin: {
        top: this.safeTwip(table.cellMarginTop),
        bottom: this.safeTwip(table.cellMarginBottom),
        left: this.safeTwip(table.cellMarginLeft),
        right: this.safeTwip(table.cellMarginRight),
      },
    };
  }
  resolveHeader(
    themePayload: DocxRenderPayload['theme'],
    rendererHints: DocxRendererHints,
    theme: DocxThemeRuntime,
  ) {
    const text = rendererHints.header?.text;
    if (!text) return undefined;

    return {
      default: new Header({
        children: [
          new Paragraph({
            alignment: this.align(
              this.safeHeaderFooterAlign(rendererHints.header?.align, 'right'),
            ),
            children: [
              new TextRun({
                text,
                color: theme.mutedColor,
                size: 18,
                font: theme.fontFamily,
              }),
            ],
          }),
        ],
      }),
    };
  }

  resolveFooter(
    themePayload: DocxRenderPayload['theme'],
    rendererHints: DocxRendererHints,
    theme: DocxThemeRuntime,
  ) {
    const showPageNumber =
      rendererHints.footer?.showPageNumber === true || themePayload?.showPageNumber === true;

    const footerText = rendererHints.footer?.text;

    if (!showPageNumber && !footerText) return undefined;

    return {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: this.align(
              this.safeHeaderFooterAlign(rendererHints.footer?.align, 'center'),
            ),
            children: this.resolveFooterRuns(
              footerText,
              showPageNumber,
              theme,
              rendererHints,
            ),
          }),
        ],
      }),
    };
  }

  private resolveFooterRuns(
    textPattern: string | undefined,
    showPageNumber: boolean,
    theme: DocxThemeRuntime,
    rendererHints: DocxRendererHints,
  ): TextRun[] {
    const font = rendererHints.footer?.fontFamily ?? theme.fontFamily;
    const size =
      this.resolveFontSizePt(rendererHints.footer?.fontSizePt, undefined) ??
      18;

    const pattern = textPattern ?? (showPageNumber ? '{page}' : '');

    if (!pattern) return [];

    return pattern
      .split(/(\{page\})/g)
      .filter(Boolean)
      .map((part) => {
        if (part === '{page}') {
          return new TextRun({
            children: [PageNumber.CURRENT],
            size,
            color: theme.mutedColor,
            font,
          });
        }

        return new TextRun({
          text: part,
          size,
          color: theme.mutedColor,
          font,
        });
      });
  }

  public resolvePageMargins(
    theme: DocxRenderPayload['theme'],
    rendererHints: DocxRendererHints,
  ) {
    const page = this.asRecord(rendererHints.page);
    const margin = this.asRecord(theme?.margin);

    return {
      top:
        page.marginTop ??
        this.cmToTwip(this.numberOrUndefined(page.marginTopCm)) ??
        margin.top ??
        0,
      right:
        page.marginRight ??
        this.cmToTwip(this.numberOrUndefined(page.marginRightCm)) ??
        margin.right ??
        0,
      bottom:
        page.marginBottom ??
        this.cmToTwip(this.numberOrUndefined(page.marginBottomCm)) ??
        margin.bottom ??
        0,
      left:
        page.marginLeft ??
        this.cmToTwip(this.numberOrUndefined(page.marginLeftCm)) ??
        margin.left ??
        0,
    };
  }

  public align(value?: unknown) {
    if (value === 'center') return AlignmentType.CENTER;
    if (value === 'right') return AlignmentType.RIGHT;
    if (value === 'justify') return AlignmentType.JUSTIFIED;
    if (value === 'left') return AlignmentType.LEFT;
    return undefined;
  }

  resolveSpacingAfter(rendererHints: DocxRendererHints): number | undefined {
    const paragraph = this.asRecord(rendererHints.paragraph);
    return this.safeTwip(paragraph.spacingAfterTwips) ?? this.ptToTwip(this.numberOrUndefined(paragraph.spacingAfterPt)) ?? this.safeTwip(paragraph.spacingAfter);
  }

  resolveFirstLineIndent(rendererHints: DocxRendererHints): number | undefined {
    const paragraph = this.asRecord(rendererHints.paragraph);

    return (
      this.safeTwip(paragraph.firstLineTwips) ??
      this.cmToTwip(this.numberOrUndefined(paragraph.firstLineIndentCm)) ??
      this.safeTwip(paragraph.firstLineIndent)
    );
  }

  resolveHangingIndent(rendererHints: DocxRendererHints): number | undefined {
    const paragraph = this.asRecord(rendererHints.paragraph);

    return (
      this.cmToTwip(this.numberOrUndefined(paragraph.hangingIndentCm)) ??
      this.safeTwip(paragraph.hangingIndent)
    );
  }

  resolveFontSizePt(value?: number, fallback?: number): number | undefined {
    const n = Number(value ?? fallback);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.round(n * 2);
  }

  resolveParagraphSpacing(
    raw: unknown,
    fallback: { before?: number; after?: number; line?: number },
    theme: DocxThemeRuntime,
  ) {
    const value = this.asRecord(raw);

    return {
      before: this.safeTwip(value.spacingBeforeTwips) ?? this.ptToTwip(this.numberOrUndefined(value.spacingBeforePt)) ?? this.safeTwip(value.before) ?? fallback.before,
      after: this.safeTwip(value.spacingAfterTwips) ?? this.ptToTwip(this.numberOrUndefined(value.spacingAfterPt)) ?? this.safeTwip(value.after) ?? fallback.after,
      line:
        this.safeTwip(value.lineSpacingTwips) ??
        this.resolveLineSpacing(value) ??
        this.safeTwip(value.line) ??
        fallback.line ??
        theme.paragraphLineSpacing,
      lineRule:
        this.resolveLineRule(value.lineRule) ?? theme.paragraphLineRule,
    };
  }
  private resolveLineSpacing(paragraph: Record<string, any>): number | undefined {
    const lineSpacingTwips = this.numberOrUndefined(paragraph.lineSpacingTwips);
    if (lineSpacingTwips !== undefined) return Math.round(lineSpacingTwips);

    const lineSpacingPt = this.numberOrUndefined(paragraph.lineSpacingPt);
    if (lineSpacingPt !== undefined) {
      return this.ptToTwip(lineSpacingPt);
    }

    const multiple = this.numberOrUndefined(paragraph.lineSpacingMultiple);
    if (multiple !== undefined && multiple > 0) {
      return Math.round(multiple * 240);
    }

    const lineRule = String(paragraph.lineRule ?? '').trim().toLowerCase();

    if (lineRule === 'single') return 240;
    if (lineRule === '1.5' || lineRule === 'oneandhalf') return 360;
    if (lineRule === 'double') return 480;

    return undefined;
  }

  private resolveLineRule(
    value: unknown,
  ): (typeof LineRuleType)[keyof typeof LineRuleType] | undefined {
    const raw = String(value ?? '').trim().toLowerCase();

    if (raw === 'exact' || raw === 'fixed') return LineRuleType.EXACT;

    if (
      raw === 'atleast' ||
      raw === 'at_least' ||
      raw === 'at-least' ||
      raw === 'minimum'
    ) {
      return LineRuleType.AT_LEAST;
    }

    if (
      raw === 'single' ||
      raw === '1.5' ||
      raw === 'oneandhalf' ||
      raw === 'double' ||
      raw === 'multiple' ||
      raw === 'auto'
    ) {
      return LineRuleType.AUTO;
    }

    return undefined;
  }


  resolveParagraphIndent(
    raw: unknown,
    fallback?: {
      left?: number;
      right?: number;
      firstLine?: number;
      hanging?: number;
    },
  ) {
    const value = this.asRecord(raw);

    const indent = {
      left:
        this.safeTwip(value.leftTwips) ??
        this.cmToTwip(this.numberOrUndefined(value.leftCm)) ??
        this.safeTwip(value.left) ??
        fallback?.left,
      right:
        this.safeTwip(value.rightTwips) ??
        this.cmToTwip(this.numberOrUndefined(value.rightCm)) ??
        this.safeTwip(value.right) ??
        fallback?.right,
      firstLine:
        this.safeTwip(value.firstLineTwips) ??
        this.cmToTwip(this.numberOrUndefined(value.firstLineCm)) ??
        this.safeTwip(value.firstLine) ??
        fallback?.firstLine,
      hanging:
        this.cmToTwip(this.numberOrUndefined(value.hangingCm)) ??
        this.safeTwip(value.hanging) ??
        fallback?.hanging,
    };

    if (
      indent.left === undefined &&
      indent.right === undefined &&
      indent.firstLine === undefined &&
      indent.hanging === undefined
    ) {
      return undefined;
    }

    return indent;
  }

  resolveParagraphBorder(raw: unknown) {
    const border = this.asRecord(raw);
    if (!Object.keys(border).length) return undefined;

    return {
      top: this.resolveBorderSide(border.top),
      bottom: this.resolveBorderSide(border.bottom),
      left: this.resolveBorderSide(border.left),
      right: this.resolveBorderSide(border.right),
    };
  }

  resolveParagraphShading(raw: unknown) {
    const shading = this.asRecord(raw);
    const fill = this.cleanColor(String(shading.fill ?? shading.color ?? ''));
    if (!fill) return undefined;

    return {
      type: ShadingType.CLEAR,
      fill,
    };
  }

  resolveTableWidth(tableSpec: unknown) {
    const table = this.asRecord(tableSpec);
    const width = this.asRecord(table.width);

    if (width.type === 'dxa' || width.type === 'DXA') {
      return {
        size: this.safeTwip(width.size) ?? 9000,
        type: WidthType.DXA,
      };
    }

    return {
      size: this.numberOrUndefined(width.size) ?? 100,
      type: WidthType.PERCENTAGE,
    };
  }

  resolveTableBorders(raw: unknown, theme: DocxThemeRuntime) {
    const borders = this.asRecord(raw);
    if (!Object.keys(borders).length) {
      return this.resolveCellBorders(undefined, theme);
    }

    return {
      top: this.resolveBorderSide(borders.top, theme.borderColor, theme),
      bottom: this.resolveBorderSide(borders.bottom, theme.borderColor, theme),
      left: this.resolveBorderSide(borders.left, theme.borderColor, theme),
      right: this.resolveBorderSide(borders.right, theme.borderColor, theme),
      insideHorizontal: this.resolveBorderSide(borders.insideHorizontal, theme.borderColor, theme),
      insideVertical: this.resolveBorderSide(borders.insideVertical, theme.borderColor, theme),
    };
  }

  resolveCellBorders(raw: unknown, theme: DocxThemeRuntime) {
    const borders = this.asRecord(raw);

    return {
      top: this.resolveBorderSide(borders.top, theme.borderColor, theme),
      bottom: this.resolveBorderSide(borders.bottom, theme.borderColor, theme),
      left: this.resolveBorderSide(borders.left, theme.borderColor, theme),
      right: this.resolveBorderSide(borders.right, theme.borderColor, theme),
    };
  }

  resolveTableCellMargins(
    cell: NormalizedDocxTableCell,
    theme: DocxThemeRuntime,
    compact: boolean,
  ) {
    const raw = this.asRecord((cell as any).margins);
    const fallback = compact
      ? { top: 70, bottom: 70, left: 90, right: 90 }
      : { top: 110, bottom: 110, left: 120, right: 120 };

    return {
      top: this.safeTwip(raw.top) ?? theme.tableCellMargin?.top ?? fallback.top,
      bottom: this.safeTwip(raw.bottom) ?? theme.tableCellMargin?.bottom ?? fallback.bottom,
      left: this.safeTwip(raw.left) ?? theme.tableCellMargin?.left ?? fallback.left,
      right: this.safeTwip(raw.right) ?? theme.tableCellMargin?.right ?? fallback.right,
    };
  }

  private safeHeaderFooterAlign(
    value: unknown,
    fallback: 'left' | 'center' | 'right',
  ): 'left' | 'center' | 'right' {
    if (value === 'left' || value === 'center' || value === 'right') {
      return value;
    }

    return fallback;
  }

  cmToTwip(value?: number): number | undefined {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.round(n * 567);
  }

  ptToTwip(value?: number): number | undefined {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.round(n * 20);
  }

  safeTwip(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  }

  numberOrUndefined(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }

    return undefined;
  }

  safeParagraphAlign(value: unknown): 'left' | 'center' | 'right' | 'justify' | undefined {
    if (
      value === 'left' ||
      value === 'center' ||
      value === 'right' ||
      value === 'justify'
    ) {
      return value;
    }

    if (value === 'both' || value === 'distribute') return 'justify';
    return undefined;
  }

  cleanColor(color: string): string {
    const clean = String(color || '')
      .replace(/^#/, '')
      .replace(/[^0-9a-fA-F]/g, '')
      .slice(0, 6);

    return clean || '';
  }

  asRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
  }

  private inferBlockStyleRef(block: Record<string, unknown>): string {
    const type = String(block.type ?? 'paragraph');
    const meta = this.asRecord(block.meta);
    const semanticRole = String(block.semanticRole ?? meta.semanticRole ?? '');

    if (semanticRole === 'documentTitle') return 'title';
    if (type === 'heading' || type === 'title') return 'title';
    if (type === 'table') return 'table';
    return 'body';
  }

  private mergeStyleRecords(
    ...items: Array<Record<string, unknown> | undefined | null>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const item of items) {
      if (!item) continue;

      for (const [key, value] of Object.entries(item)) {
        if (value === undefined || value === null || value === '') continue;
        result[key] = value;
      }
    }

    return result;
  }

  private resolveBorderSide(
    raw: unknown,
    fallbackColor = 'D9D9D9',
    theme?: DocxThemeRuntime,
  ) {
    const side = this.asRecord(raw);
    const disabled = side.none === true || side.style === 'none';

    if (disabled) {
      return {
        style: BorderStyle.NONE,
        size: 0,
        color: 'FFFFFF',
      };
    }

    return {
      style: this.borderStyle(side.style ?? (theme as any)?.tableBorderStyle),
      size:
        this.numberOrUndefined(side.size) ??
        this.numberOrUndefined((theme as any)?.tableBorderSize) ??
        1,
      color: this.cleanColor(String(side.color ?? fallbackColor)) || fallbackColor,
    };
  }

  private borderStyle(value: unknown): (typeof BorderStyle)[keyof typeof BorderStyle] {
    const style = String(value ?? '').toLowerCase();
    if (style === 'dashed') return BorderStyle.DASHED;
    if (style === 'dotted') return BorderStyle.DOTTED;
    if (style === 'double') return BorderStyle.DOUBLE;
    if (style === 'none') return BorderStyle.NONE;
    return BorderStyle.SINGLE;
  }

  private normalizeResolvedBlockStyle(
    style: Record<string, unknown>,
    theme?: DocxThemeRuntime,
  ): Record<string, unknown> {
    const normalized = this.cleanStyleRecord({
      ...style,
      align: this.safeParagraphAlign(style.align ?? style.alignment),
      fontFamily: this.firstString(style.fontFamily),
      fontSizePt: this.numberOrUndefined(style.fontSizePt),
      color: this.cleanColor(String(style.color ?? '')) || undefined,
      backgroundColor:
        this.cleanColor(String(style.backgroundColor ?? '')) || undefined,
      bold: this.booleanOrUndefined(style.bold),
      italics: this.booleanOrUndefined(style.italics ?? style.italic),
      underline: this.booleanOrUndefined(style.underline),
      spacing: this.cleanStyleRecord({
        spacingBeforeTwips: this.safeTwip(style.spacingBeforeTwips),
        spacingAfterTwips: this.safeTwip(style.spacingAfterTwips),
        lineSpacingTwips: this.safeTwip(style.lineSpacingTwips),
        spacingBeforePt: this.numberOrUndefined(style.spacingBeforePt),
        spacingAfterPt: this.numberOrUndefined(style.spacingAfterPt),
        lineSpacingPt: this.numberOrUndefined(style.lineSpacingPt),
        lineRule: style.lineRule,
        lineSpacingMultiple: this.numberOrUndefined(style.lineSpacingMultiple),
      }),
      indent: this.cleanStyleRecord({
        firstLineTwips: this.safeTwip(style.firstLineTwips),
        leftTwips: this.safeTwip(style.leftTwips),
        rightTwips: this.safeTwip(style.rightTwips),
        firstLineCm: this.numberOrUndefined(style.firstLineIndentCm),
        firstLine: this.safeTwip(style.firstLineIndent),
        left: this.safeTwip(style.leftIndent),
        right: this.safeTwip(style.rightIndent),
      }),
      keepWithNext: this.booleanOrUndefined(style.keepWithNext),
      pageBreakBefore: this.booleanOrUndefined(style.pageBreakBefore),
    });

    if (!normalized.fontFamily && theme?.fontFamily) {
      normalized.fontFamily = theme.fontFamily;
    }

    return normalized;
  }

  private cleanStyleRecord(value: Record<string, unknown>): Record<string, unknown> {
    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, item]) => {
      if (item === undefined || item === null || item === '') return acc;
      if (
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        !Object.keys(item as Record<string, unknown>).length
      ) {
        return acc;
      }
      acc[key] = item;
      return acc;
    }, {});
  }

  private booleanOrUndefined(value: unknown): boolean | undefined {
    if (value === true) return true;
    if (value === false) return false;
    return undefined;
  }
}