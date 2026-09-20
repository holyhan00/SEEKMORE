                                                                

import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { RenderArtifact, RenderRequest } from '../../render.types';
import { buildDocumentPreview } from '../../preview/render-preview.builder';
import { DocxRenderMapper } from './docx-render.mapper';
import { DocxRenderValidator } from './docx-render.validator';
import {
  DocxBlock,
  DocxRenderPayload,
  DocxTextRunSpec,
  NormalizedDocxTableCell,
} from './docx-render.types';
import {
  DocxRendererHints,
  DocxStyleResolver,
  DocxThemeRuntime,
} from './docx-style.resolver';

@Injectable()
export class DocxRenderService {
  constructor(
    private readonly mapper: DocxRenderMapper,
    private readonly validator: DocxRenderValidator,
    private readonly styleResolver: DocxStyleResolver,
  ) {}

  async render(
    request: RenderRequest<DocxRenderPayload>,
  ): Promise<RenderArtifact> {
    const payload = (request.payload ?? {}) as DocxRenderPayload;

    this.validator.validate(payload);

    const normalized = this.mapper.normalize(payload);
    const rendererHints = this.styleResolver.extractRendererHints(payload);
    const theme = this.styleResolver.buildTheme(normalized.theme, rendererHints);

    const children: Array<Paragraph | Table> = [];

    const title = normalized.title || request.title;

    for (const block of normalized.blocks) {
      children.push(...this.renderBlock(block, theme, rendererHints));
    }

    const doc = new Document({
      creator: normalized.theme.author,
      description: request.meta?.description
        ? String(request.meta.description)
        : undefined,
      title: title || request.filename || 'document',
      styles: {
        default: {
          document: {
            run: {
              font: theme.fontFamily,
              size: theme.defaultFontSize,
              color: theme.textColor,
            },
            paragraph: {
              spacing: {
                line: theme.paragraphLineSpacing,
                lineRule: theme.paragraphLineRule,
                after: theme.paragraphSpacingAfter,
              },
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size:
                normalized.theme.orientation === 'landscape'
                  ? { orientation: 'landscape' }
                  : undefined,
              margin: this.styleResolver.resolvePageMargins(
                normalized.theme,
                rendererHints,
              ),
            },
          },
          headers: this.styleResolver.resolveHeader(
            normalized.theme,
            rendererHints,
            theme,
          ),
          footers: this.styleResolver.resolveFooter(
            normalized.theme,
            rendererHints,
            theme,
          ),
          children: children.length ? children : [new Paragraph('')],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    const filename = this.safeFilename(
      request.filename || `${title || 'document'}.docx`,
    );

    const persisted = {
      buffer,
      filename,
      extension: 'docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

      userId: request.userId,
      conversationId: request.conversationId,
      requestId: request.requestId,

      source: request.source ?? 'agent',
      category: 'document',
      renderer: 'docx-render.service',
      rendererVersion: '3.1.0',

      preview: buildDocumentPreview({
        title,
        blocks: normalized.blocks,
        theme: normalized.theme,
      }),
      meta: {
        ...request.meta,
        title,
        blockCount: normalized.blocks.length,
      },
    };

    return persisted;
  }

  private renderBlock(
    block: DocxBlock,
    theme: DocxThemeRuntime,
    rendererHints: DocxRendererHints,
  ): Array<Paragraph | Table> {
    const blockStyle = this.styleResolver.resolveBlockStyle({
      block,
      rendererHints,
      theme,
    } as any) as Record<string, any>;
    switch (block.type) {
      case 'heading':
        return [
          new Paragraph({
            heading: this.headingLevel(block.level ?? 2),
            keepNext: blockStyle.keepWithNext,
            pageBreakBefore: blockStyle.pageBreakBefore,
            alignment: this.styleResolver.align(
              (block as any).align ?? blockStyle.align,
            ),
            spacing: this.styleResolver.resolveParagraphSpacing(
              (block as any).spacing ?? blockStyle.spacing,
              {
                before: undefined,
                after: undefined,
              },
              theme,
            ),
            indent: this.styleResolver.resolveParagraphIndent(
              (block as any).indent ?? blockStyle.indent,
              undefined,
            ),
            children: [
              new TextRun({
                text: block.text,
                bold: blockStyle.bold,
                italics: blockStyle.italics,
                underline: blockStyle.underline ? {} : undefined,
                color: this.styleResolver.cleanColor(
                  blockStyle.color || theme.textColor,
                ),
                size: this.resolveHeadingRunSize(block, theme, blockStyle),
                font: this.resolveHeadingRunFont(block, theme, blockStyle),
              }),
            ],
          }),
        ];

      case 'paragraph':
        return [
          new Paragraph({
            keepNext: blockStyle.keepWithNext,
            pageBreakBefore: blockStyle.pageBreakBefore,
            alignment: this.styleResolver.align(
              (block as any).align ?? blockStyle.align ?? theme.defaultParagraphAlign,
            ),
            spacing: this.styleResolver.resolveParagraphSpacing(
              (block as any).spacing ?? blockStyle.spacing,
              {
                after:
                  theme.paragraphSpacingAfter,
                line: theme.paragraphLineSpacing,
              },
              theme,
            ),
            indent: this.styleResolver.resolveParagraphIndent(
              (block as any).indent ?? blockStyle.indent,
              {
                firstLine: theme.paragraphFirstLineIndent,
                hanging: theme.paragraphHangingIndent,
              },
            ),
            border: this.styleResolver.resolveParagraphBorder(
              (block as any).border ?? blockStyle.border,
            ),
            shading: this.styleResolver.resolveParagraphShading(
              (block as any).shading ?? blockStyle.shading,
            ),
            children: block.runs?.length
              ? block.runs.map((run) => this.renderTextRun(run, theme, blockStyle))
              : [
                  new TextRun({
                    text: block.text || '',
                    font: blockStyle.fontFamily || theme.fontFamily,
                    color: this.styleResolver.cleanColor(
                      blockStyle.color || theme.textColor,
                    ),
                    bold: blockStyle.bold,
                    italics: blockStyle.italics,
                    underline: blockStyle.underline ? {} : undefined,
                    size:
                      this.styleResolver.resolveFontSizePt(
                        blockStyle.fontSizePt,
                        undefined,
                      ) ??
                      blockStyle.size ??
                      theme.defaultFontSize,
                  }),
                ],
          }),
        ];

      case 'quote':
        return [
          new Paragraph({
            keepNext: blockStyle.keepWithNext,
            pageBreakBefore: blockStyle.pageBreakBefore,
            spacing: this.styleResolver.resolveParagraphSpacing(
              (block as any).spacing ?? blockStyle.spacing,
              {},
              theme,
            ),
            indent: this.styleResolver.resolveParagraphIndent(
              (block as any).indent ?? blockStyle.indent,
              undefined,
            ),
            border: this.styleResolver.resolveParagraphBorder((block as any).border ?? blockStyle.border),
            children: [
              new TextRun({
                text: block.text,
                italics: blockStyle.italics,
                color: this.styleResolver.cleanColor(blockStyle.color || theme.mutedColor),
                font: blockStyle.fontFamily || theme.fontFamily,
                size:
                  this.styleResolver.resolveFontSizePt(blockStyle.fontSizePt, undefined) ??
                  blockStyle.size ??
                  theme.defaultFontSize,
              }),
            ],
          }),
        ];

      case 'list':
        return block.items.map((item, index) => {
          const text = block.ordered ? `${index + 1}. ${item}` : item;

          return new Paragraph({
            bullet: block.ordered ? undefined : { level: 0 },
            spacing: this.styleResolver.resolveParagraphSpacing(
              (block as any).spacing ?? blockStyle.spacing,
              { after: 80 },
              theme,
            ),
            indent: this.styleResolver.resolveParagraphIndent(
              (block as any).indent ?? blockStyle.indent,
              undefined,
            ),
            children: [
              new TextRun({
                text,
                font: blockStyle.fontFamily || theme.fontFamily,
                color: this.styleResolver.cleanColor(
                  blockStyle.color || theme.textColor,
                ),
                size:
                  this.styleResolver.resolveFontSizePt(
                    blockStyle.fontSizePt,
                    undefined,
                  ) ??
                  blockStyle.size ??
                  theme.defaultFontSize,
              }),
            ],
          });
        });

      case 'table':
        return this.renderTable(block.table, theme, rendererHints);

      case 'image':
        return this.renderImage(block, theme);

      case 'pageBreak':
        return [
          new Paragraph({
            children: [new PageBreak()],
          }),
        ];

      case 'spacer':
        return [
          new Paragraph({
            spacing: {
              before: (block as any).before ?? block.size ?? 240,
              after: (block as any).after ?? 0,
            },
            children: [new TextRun({ text: '' })],
          }),
        ];

      default:
        return [];
    }
  }

  private renderImage(
    block: Extract<DocxBlock, { type: 'image' }>,
    theme: DocxThemeRuntime,
  ): Paragraph[] {
    const imageBuffer = Buffer.from(
      block.image.dataBase64.replace(/^data:[^;]+;base64,/, ''),
      'base64',
    );

    const paragraphs: Paragraph[] = [
      new Paragraph({
        alignment: this.styleResolver.align(block.image.align || 'center'),
        spacing: { before: 160, after: 120 },
        children: [
          new ImageRun({
            type: this.imageType(block.image.dataBase64),
            data: imageBuffer,
            transformation: {
              width: block.image.width || 480,
              height: block.image.height || 270,
            },
          }),
        ],
      }),
    ];

    if (block.image.caption) {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 180 },
          children: [
            new TextRun({
              text: block.image.caption,
              size: 18,
              color: theme.mutedColor,
              font: theme.fontFamily,
            }),
          ],
        }),
      );
    }

    return paragraphs;
  }

  private renderTable(
    tableSpec: Extract<DocxBlock, { type: 'table' }>['table'],
    theme: DocxThemeRuntime,
    rendererHints: DocxRendererHints,
  ): Array<Paragraph | Table> {
    const normalized = this.mapper.normalizeTable(tableSpec);
    const nodes: Array<Paragraph | Table> = [];

    const titleStyle = this.styleResolver.resolveBlockStyle({
      block: {
        type: 'paragraph',
        text: tableSpec.title || '',
        style: (tableSpec as any).style?.title,
        semanticRole: 'tableTitle',
      } as any,
      rendererHints,
      theme,
    } as any) as Record<string, any>;

    if (normalized.title) {
      nodes.push(
        new Paragraph({
          spacing: this.styleResolver.resolveParagraphSpacing(
            titleStyle.spacing,
            { before: 220, after: 120 },
            theme,
          ),
          alignment: this.styleResolver.align(titleStyle.align),
          children: [
            new TextRun({
              text: normalized.title,
              bold: titleStyle.bold,
              color: this.styleResolver.cleanColor(titleStyle.color || theme.textColor),
              size:
                this.styleResolver.resolveFontSizePt(titleStyle.fontSizePt, undefined) ??
                titleStyle.size ??
                theme.defaultFontSize,
              font: titleStyle.fontFamily || theme.headingFontFamily,
            }),
          ],
        }),
      );
    }

    const columnCount = Math.max(
      normalized.headers.length,
      ...normalized.rows.map((row) => row.length),
      1,
    );

    const rows: TableRow[] = [];

    if (normalized.headers.length) {
      rows.push(
        new TableRow({
          tableHeader: true,
          children: this.padRow(normalized.headers, columnCount).map((cell) =>
            this.renderTableCell(cell, {
              theme,
              isHeader: true,
              columnCount,
              compact: normalized.compact ?? theme.compactTables,
            }),
          ),
        }),
      );
    }

    normalized.rows.forEach((row, rowIndex) => {
      const striped = normalized.striped ?? theme.stripedTables;

      rows.push(
        new TableRow({
          children: this.padRow(row, columnCount).map((cell) =>
            this.renderTableCell(cell, {
              theme,
              isHeader: false,
              columnCount,
              compact: normalized.compact ?? theme.compactTables,
              rowFill: striped && rowIndex % 2 === 1 ? theme.accentColor || undefined : undefined,
            }),
          ),
        }),
      );
    });

    nodes.push(
      new Table({
        width: this.styleResolver.resolveTableWidth(tableSpec),
        borders: this.styleResolver.resolveTableBorders(
          (tableSpec as any).borders,
          theme,
        ),
        rows: rows.length
          ? rows
          : [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph('')],
                  }),
                ],
              }),
            ],
      }),
    );

    if (normalized.caption) {
      nodes.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 180 },
          children: [
            new TextRun({
              text: normalized.caption,
              size: 18,
              color: theme.mutedColor,
              font: theme.fontFamily,
            }),
          ],
        }),
      );
    }

    return nodes;
  }

  private renderTableCell(
    cell: NormalizedDocxTableCell,
    options: {
      theme: DocxThemeRuntime;
      isHeader: boolean;
      columnCount: number;
      compact: boolean;
      rowFill?: string;
    },
  ): TableCell {
    const { theme, isHeader, columnCount, compact, rowFill } = options;

    const fill =
      this.styleResolver.cleanColor(cell.shading || '') ||
      (isHeader ? theme.accentColor : rowFill);

    return new TableCell({
      columnSpan: cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined,
      rowSpan: cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined,
      verticalAlign: VerticalAlign.CENTER,
      width: {
        size: cell.width || Math.floor(9000 / Math.max(columnCount, 1)),
        type: WidthType.DXA,
      },
      shading: fill
        ? {
            type: ShadingType.CLEAR,
            fill,
          }
        : undefined,
      margins: this.styleResolver.resolveTableCellMargins(cell, theme, compact),
      borders: this.styleResolver.resolveCellBorders((cell as any).borders, theme),
      children: [
        new Paragraph({
          alignment:
            this.styleResolver.align(cell.align) ||
            undefined,
          spacing: this.styleResolver.resolveParagraphSpacing(
            (cell as any).paragraphStyle?.spacing,
            { after: 0 },
            theme,
          ),
          indent: this.styleResolver.resolveParagraphIndent(
            (cell as any).paragraphStyle?.indent,
            undefined,
          ),
          children: [
            new TextRun({
              text: cell.text || '',
              bold: cell.bold,
              italics: cell.italics,
              underline: (cell as any).underline ? {} : undefined,
              color: this.styleResolver.cleanColor(
                cell.color || theme.textColor,
              ),
              size:
                this.styleResolver.resolveFontSizePt(
                  (cell as any).fontSizePt,
                  undefined,
                ) ??
                (cell as any).size ??
                theme.defaultFontSize,
              font: (cell as any).fontFamily || theme.fontFamily,
            }),
          ],
        }),
      ],
    });
  }

  private renderTextRun(
    run: DocxTextRunSpec,
    theme: DocxThemeRuntime,
    inheritedStyle?: Record<string, any>,
  ): TextRun {
    return new TextRun({
      text: run.text,
      bold: run.bold ?? inheritedStyle?.bold,
      italics: run.italics ?? inheritedStyle?.italics,
      underline: (run.underline ?? inheritedStyle?.underline) ? {} : undefined,
      strike: run.strike,
      color: this.styleResolver.cleanColor(
        (run as any).color || inheritedStyle?.color || theme.textColor,
      ),
      size:
        this.styleResolver.resolveFontSizePt(
          (run as any).fontSizePt ?? inheritedStyle?.fontSizePt,
          undefined,
        ) ??
        run.size ??
        inheritedStyle?.size ??
        theme.defaultFontSize,
      break: run.break,
      font:
        (run as any).fontFamily ||
        inheritedStyle?.fontFamily ||
        (this.isLikelyNumberRun(run.text)
          ? theme.numberFontFamily
          : theme.fontFamily),
    });
  }

  private padRow(
    row: NormalizedDocxTableCell[],
    target: number,
  ): NormalizedDocxTableCell[] {
    const next = [...row];

    while (next.length < target) {
      next.push({ text: '' });
    }

    return next;
  }

  private headingLevel(level: number) {
    if (level <= 1) return HeadingLevel.HEADING_1;
    if (level === 2) return HeadingLevel.HEADING_2;
    if (level === 3) return HeadingLevel.HEADING_3;
    if (level === 4) return HeadingLevel.HEADING_4;
    if (level === 5) return HeadingLevel.HEADING_5;
    return HeadingLevel.HEADING_6;
  }

  private resolveHeadingRunSize(
    block: Extract<DocxBlock, { type: 'heading' }>,
    theme: DocxThemeRuntime,
    resolvedStyle?: Record<string, any>,
  ): number | undefined {
    const style = resolvedStyle ?? (block as any).style ?? {};
    const level = block.level ?? 2;

    return (
      this.styleResolver.resolveFontSizePt(style.fontSizePt, undefined) ??
      this.styleResolver.resolveFontSizePt(
        level <= 1 ? style.titleFontSizePt : style.headingFontSizePt,
        undefined,
      ) ??
      this.styleResolver.resolveFontSizePt(style.headingFontSizePt, undefined) ??
      style.size ??
      this.resolveHeadingSize(level, theme)
    );
  }

  private resolveHeadingRunFont(
    block: Extract<DocxBlock, { type: 'heading' }>,
    theme: DocxThemeRuntime,
    resolvedStyle?: Record<string, any>,
  ): string {
    const style = resolvedStyle ?? (block as any).style ?? {};
    const level = block.level ?? 2;

    if (level <= 1) {
      return (
        String(style.titleFontFamily || '').trim() ||
        String(style.fontFamily || '').trim() ||
        theme.titleFontFamily
      );
    }

    return (
      String(style.headingFontFamily || '').trim() ||
      String(style.fontFamily || '').trim() ||
      theme.headingFontFamily
    );
  }

  private resolveHeadingSize(
    _level: number,
    theme: DocxThemeRuntime,
  ): number | undefined {
    return theme.defaultHeadingFontSize ?? theme.defaultFontSize;
  }

  private isLikelyNumberRun(text: unknown): boolean {
    return /^[0-9０-９¥￥,.，:：\-—/年月日\s]+$/.test(
      String(text ?? '').trim(),
    );
  }

  private imageType(dataBase64: string): 'png' | 'jpg' | 'gif' | 'bmp' {
    const head = String(dataBase64 || '').slice(0, 80).toLowerCase();

    if (head.includes('image/jpeg') || head.includes('image/jpg')) {
      return 'jpg';
    }

    if (head.includes('image/gif')) {
      return 'gif';
    }

    if (head.includes('image/bmp')) {
      return 'bmp';
    }

    return 'png';
  }

  private safeFilename(filename: string): string {
    const clean = filename.replace(/[\\/:*?"<>|]/g, '_').trim();

    return clean.toLowerCase().endsWith('.docx')
      ? clean
      : `${clean || 'document'}.docx`;
  }
}