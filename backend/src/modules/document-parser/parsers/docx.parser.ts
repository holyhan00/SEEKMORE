import { BadRequestException, Injectable } from '@nestjs/common';
import * as mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import * as JSZip from 'jszip';
import { ParseDocumentInput, ParsedDocument } from '../document.types';
import { DocumentParser } from './document-parser.interface';
import { inspectZipCentralDirectory, ZipContainerError } from './zip-central-directory.util';

type XmlRecord = Record<string, unknown>;
type ZipArchive = Awaited<ReturnType<typeof JSZip.loadAsync>>;

interface DocxParagraphStyle {
  index: number;
  textPreview: string;
  textLength: number;
  align?: string;
  styleName: string | null;
  fontFamily: string | null;
  fontSizePt: number | null;
  bold: boolean;
  italic: boolean;
  firstLineIndentPt: number | null;
  firstLineIndentCm: number | null;
  leftIndentPt: number | null;
  rightIndentPt: number | null;
  lineSpacingPt: number | null;
  lineRule: string | undefined;
  lineSpacingMultiple: number | null;
  spacingBeforePt: number | null;
  spacingAfterPt: number | null;
  isHeading: boolean;
  headingLevel: number | null;
}

interface DocxLayoutBlock {
  id: string;
  kind: 'text' | 'title' | 'body' | 'table' | 'header' | 'footer' | 'unknown';
  type: 'paragraph' | 'table' | 'header' | 'footer';
  order: number;
  contentPreview: string;
  style: XmlRecord;
  table?: XmlRecord;
  source: {
    parser: 'docx_openxml';
    index: number;
  };
}

@Injectable()
export class DocxDocumentParser implements DocumentParser {
  readonly kind = 'docx' as const;
  readonly version = '2.0.0';

  readonly support = {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    extensions: ['docx'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();

    return (
      ext === 'docx' ||
      input.mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    this.assertSafeContainer(input.buffer);

    const htmlResult = await mammoth.convertToHtml({ buffer: input.buffer });
    const rawTextResult = await mammoth.extractRawText({ buffer: input.buffer });

    const html = htmlResult.value || '';
    const text = rawTextResult.value || '';

    const $ = cheerio.load(html);
    const sections = this.extractSections($);
    const tables = this.extractTables($);
    const styleProfile = await this.extractStyleProfile(input.buffer);
    const layoutAst = this.buildLayoutAst({ text, tables, styleProfile });
    const explicitHints = this.extractExplicitTemplateHints(text);
    const templateProfile = this.buildTemplateProfile({
      text,
      sections,
      tables,
      styleProfile,
      layoutAst,
      explicitHints,
      input,
    });
    const rendererHints = this.buildRendererHints(templateProfile);

    return {
      text,
      title: input.objectName,
      kind: this.kind,
      mimeType: input.mimeType,
      extension: input.extension,
      sections,
      tables,
      styleProfile,
      layoutAst,
      explicitHints,
      templateProfile,
      rendererHints,
      meta: {
        messages: htmlResult.messages || [],
        sectionCount: sections?.length ?? 0,
        tableCount: tables?.length ?? 0,
        parserVersion: 'docx-structured-style',
        hasTemplateProfile: true,
        hasRendererHints: true,
        hasLayoutAst: true,
      },
    };
  }


  private assertSafeContainer(buffer: Buffer): void {
    try {
      inspectZipCentralDirectory(buffer, {
        maxEntries: 5_000,
        maxCentralDirectoryBytes: 16 * 1024 * 1024,
        maxEntryUncompressedBytes: 96 * 1024 * 1024,
        maxTotalUncompressedBytes: 256 * 1024 * 1024,
        maxCompressionRatio: 2_000,
        rejectEncrypted: true,
        rejectUnsafePaths: true,
      });
    } catch (error) {
      if (error instanceof ZipContainerError) {
        throw new BadRequestException({
          code: error.code,
          message: `Unsafe or invalid DOCX container: ${error.message}`,
          details: error.details,
        });
      }
      throw error;
    }
  }

  private extractSections($: cheerio.CheerioAPI): ParsedDocument['sections'] {
    const sections: ParsedDocument['sections'] = [];
    let currentTitle: string | undefined;
    let currentLevel = 1;
    let currentContent: string[] = [];

    $('body')
      .children()
      .each((_, el) => {
        const tag = (el.tagName || '').toLowerCase();
        const node = $(el);
        const nodeText = node.text().trim();

        if (!nodeText) return;

        const headingMatch = /^h([1-6])$/.exec(tag);

        if (headingMatch) {
          if (currentContent.length) {
            sections.push({
              title: currentTitle,
              content: currentContent.join('\n').trim(),
              level: currentLevel,
              meta: { source: 'docx' },
            });
          }

          currentTitle = nodeText;
          currentLevel = Number(headingMatch[1]);
          currentContent = [];
          return;
        }

        if (tag !== 'table') currentContent.push(nodeText);
      });

    if (currentContent.length) {
      sections.push({
        title: currentTitle,
        content: currentContent.join('\n').trim(),
        level: currentLevel,
        meta: { source: 'docx' },
      });
    }

    return sections;
  }

  private extractTables($: cheerio.CheerioAPI): ParsedDocument['tables'] {
    const tables: ParsedDocument['tables'] = [];

    $('table').each((tableIndex, tableEl) => {
      const rawRows: string[][] = [];

      $(tableEl)
        .find('tr')
        .each((_, tr) => {
          const row: string[] = [];

          $(tr)
            .find('th,td')
            .each((_, cell) => {
              row.push($(cell).text().replace(/\s+/g, ' ').trim());
            });

          if (row.some(Boolean)) rawRows.push(row);
        });

      if (!rawRows.length) return;

      const headerRowIndex = 0;
      const headers = this.normalizeHeaders(rawRows[headerRowIndex] || []);
      const dataRows = rawRows.slice(headerRowIndex + 1);

      const rows = dataRows.map((rawRow) => {
        const record: Record<string, string> = {};
        headers.forEach((header, index) => {
          record[header] = rawRow[index] || '';
        });
        return record;
      });

      tables.push({
        sheetName: undefined,
        title: `Table ${tableIndex + 1}`,
        headers,
        rows,
        rawRows,
        headerRowIndex,
        columnProfiles: headers.map((header, index) => ({
          index,
          header,
          inferredType: 'text',
          nonEmptyCount: dataRows.filter((row) => row[index]).length,
          emptyCount: dataRows.filter((row) => !row[index]).length,
          uniqueCount: new Set(dataRows.map((row) => row[index]).filter(Boolean)).size,
        })),
        meta: {
          source: 'docx-html-table',
          tableIndex,
        },
      });
    });

    return tables;
  }

  private async extractStyleProfile(buffer: Buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await this.readZipText(zip, 'word/document.xml');
    const stylesXml = await this.readZipText(zip, 'word/styles.xml');
    const numberingXml = await this.readZipText(zip, 'word/numbering.xml');
    const documentRelsXml = await this.readZipText(zip, 'word/_rels/document.xml.rels');
    const footerXmls = await this.readFooterXmls(zip, documentXml, documentRelsXml);
    const paragraphs = this.extractParagraphStyles(documentXml, stylesXml);

    return {
      parserVersion: 'docx-structured-style',
      source: 'docx_openxml',
      confidence: documentXml ? 0.78 : 0.35,
      page: this.extractPageProfile(documentXml),
      fonts: this.extractFontProfile(documentXml, stylesXml),
      paragraphs,
      paragraphSummary: this.summarizeParagraphs(paragraphs),
      tables: this.extractTableStyleProfile(documentXml),
      drawings: this.extractDrawingProfile(documentXml),
      pageNumber: this.extractPageNumberProfile(footerXmls, stylesXml),
      raw: {
        hasDocumentXml: Boolean(documentXml),
        hasStylesXml: Boolean(stylesXml),
        hasNumberingXml: Boolean(numberingXml),
        hasDocumentRelsXml: Boolean(documentRelsXml),
        footerXmlCount: footerXmls.length,
        documentXmlLength: documentXml.length,
        stylesXmlLength: stylesXml.length,
        numberingXmlLength: numberingXml.length,
      },
    };
  }

  private buildLayoutAst(input: {
    text: string;
    tables: ParsedDocument['tables'];
    styleProfile: XmlRecord;
  }): XmlRecord {
    const paragraphs = Array.isArray(input.styleProfile.paragraphs)
      ? (input.styleProfile.paragraphs as DocxParagraphStyle[])
      : [];

    const blocks: DocxLayoutBlock[] = [];

    paragraphs.slice(0, 500).forEach((paragraph, index) => {
      const kind = this.inferLayoutBlockKind(paragraph, index);
      blocks.push({
        id: `p_${paragraph.index}`,
        kind,
        type: 'paragraph',
        order: blocks.length,
        contentPreview: paragraph.textPreview,
        style: {
          fontFamily: paragraph.fontFamily,
          fontSizePt: paragraph.fontSizePt,
          fontSizeLabel: this.fontSizePtToChineseLabel(paragraph.fontSizePt),
          bold: paragraph.bold,
          italic: paragraph.italic,
          align: paragraph.align,
          alignment: paragraph.align,
          firstLineIndentPt: paragraph.firstLineIndentPt,
          firstLineIndentCm: paragraph.firstLineIndentCm,
          leftIndentPt: paragraph.leftIndentPt,
          rightIndentPt: paragraph.rightIndentPt,
          lineSpacingPt: paragraph.lineSpacingPt,
          lineRule: paragraph.lineRule,
          lineSpacingMultiple: paragraph.lineSpacingMultiple,
          spacingBeforePt: paragraph.spacingBeforePt,
          spacingAfterPt: paragraph.spacingAfterPt,
        },
        source: {
          parser: 'docx_openxml',
          index: paragraph.index,
        },
      });
    });

    const tableProfiles = Array.isArray(input.styleProfile.tables)
      ? (input.styleProfile.tables as XmlRecord[])
      : [];

    tableProfiles.forEach((table, index) => {
      blocks.push({
        id: `tbl_${index}`,
        kind: 'table',
        type: 'table',
        order: blocks.length,
        contentPreview: `Table region ${index + 1}`,
        style: {
          align: table.alignment,
          alignment: table.alignment,
        },
        table: table,
        source: {
          parser: 'docx_openxml',
          index,
        },
      });
    });

    return {
      parserVersion: 'docx-layout-ast',
      source: 'docx_openxml',
      documentKind: 'docx',
      page: input.styleProfile.page ?? {},
      fonts: input.styleProfile.fonts ?? {},
      paragraphSummary: input.styleProfile.paragraphSummary ?? {},
      pageNumber: input.styleProfile.pageNumber ?? {},
      blocks,
      textPreview: input.text.slice(0, 2400),
    };
  }

  private inferLayoutBlockKind(
    paragraph: DocxParagraphStyle,
    order: number,
  ): DocxLayoutBlock['kind'] {
    const fontSize = paragraph.fontSizePt ?? 0;
    const isCentered = paragraph.align === 'center';
    const isShort = paragraph.textPreview.replace(/\s+/g, '').length <= 120;

    if (paragraph.isHeading) return 'title';
    if (order <= 4 && isCentered && fontSize >= 18 && isShort) return 'title';
    if (fontSize >= 18 && isShort) return 'title';
    return 'body';
  }

  private async readZipText(zip: ZipArchive, path: string): Promise<string> {
    const file = zip.file(path);
    if (!file) return '';
    return file.async('text');
  }

  private async readFooterXmls(
    zip: ZipArchive,
    documentXml: string,
    documentRelsXml: string,
  ): Promise<string[]> {
    const footerRelationIds = new Set<string>();
    const footerRefRegex = /<w:footerReference(?:\s[^>]*)?r:id="([^"]+)"/g;
    let footerRefMatch: RegExpExecArray | null;

    while ((footerRefMatch = footerRefRegex.exec(documentXml))) {
      const id = footerRefMatch[1]?.trim();
      if (id) footerRelationIds.add(id);
    }

    const footerTargets: string[] = [];
    const relationshipRegex =
      /<Relationship(?:\s[^>]*)?Id="([^"]+)"[^>]*Type="[^"]*\/footer"[^>]*Target="([^"]+)"[^>]*\/?>/g;
    let relationshipMatch: RegExpExecArray | null;

    while ((relationshipMatch = relationshipRegex.exec(documentRelsXml))) {
      const id = relationshipMatch[1]?.trim();
      const target = relationshipMatch[2]?.trim();

      if (!target) continue;
      if (footerRelationIds.size > 0 && !footerRelationIds.has(id)) continue;
      footerTargets.push(target);
    }

    if (!footerTargets.length) {
      const fallbackFooterObjects = zip
        .filter((relativePath: string) => /^word\/footer\d+\.xml$/i.test(relativePath))
        .map((file) => file.name);

      footerTargets.push(...fallbackFooterObjects.map((path) => path.replace(/^word\//, '')));
    }

    const uniqueTargets = Array.from(new Set(footerTargets));
    const result: string[] = [];

    for (const target of uniqueTargets) {
      const normalizedPath = target.startsWith('word/')
        ? target
        : `word/${target.replace(/^\.\//, '')}`;
      const xml = await this.readZipText(zip, normalizedPath);
      if (xml) result.push(xml);
    }

    return result;
  }

  private extractPageNumberProfile(footerXmls: string[], stylesXml: string) {
    const footerProfiles = footerXmls
      .map((xml, index) => this.extractFooterPageNumberProfile(xml, stylesXml, index))
      .filter((item) => item.enabled);

    if (!footerProfiles.length) {
      return {
        enabled: false,
        location: null,
        align: null,
        textPattern: null,
        fontFamily: null,
        fontSizePt: null,
        footerCount: footerXmls.length,
        variants: [],
      };
    }

    const primary = footerProfiles[0];

    return {
      enabled: true,
      location: 'footer',
      align: primary.align ?? null,
      textPattern: primary.textPattern ?? null,
      fontFamily: primary.fontFamily ?? null,
      fontSizePt: primary.fontSizePt ?? null,
      footerCount: footerXmls.length,
      variants: footerProfiles,
    };
  }

  private extractFooterPageNumberProfile(
    footerXml: string,
    stylesXml: string,
    footerIndex: number,
  ) {
    const hasPageField = /<w:instrText(?:\s[^>]*)?>\s*PAGE\s*(?:\\\*\s*MERGEFORMAT)?\s*<\/w:instrText>/i.test(
      footerXml,
    );

    if (!hasPageField) {
      return { enabled: false, footerIndex };
    }

    const paragraphs = this.matchXmlBlocks(footerXml, 'w:p');
    const pageParagraph =
      paragraphs.find((paragraphXml) => /<w:instrText(?:\s[^>]*)?>\s*PAGE/i.test(paragraphXml)) ??
      footerXml;

    const styleId = /<w:pStyle[^>]*w:val="([^"]+)"/.exec(pageParagraph)?.[1] ?? null;
    const styleXml = styleId ? this.findStyleXml(stylesXml, styleId) : '';
    const mergedXml = `${styleXml}\n${pageParagraph}`;

    const align = this.normalizeAlign(/<w:jc[^>]*w:val="([^"]+)"/.exec(mergedXml)?.[1]);

    const fontFamily =
      /w:eastAsia="([^"]+)"/.exec(mergedXml)?.[1] ??
      /w:ascii="([^"]+)"/.exec(mergedXml)?.[1] ??
      null;

    const fontSizeHalfPt = /<w:sz[^>]*w:val="(\d+)"/.exec(mergedXml)?.[1];
    const fontSizePt = fontSizeHalfPt ? Number(fontSizeHalfPt) / 2 : null;

    return {
      enabled: true,
      footerIndex,
      location: 'footer',
      align: align ?? 'center',
      textPattern: this.extractPageNumberPattern(pageParagraph),
      fontFamily,
      fontSizePt,
      styleName: styleId,
    };
  }

  private extractPageNumberPattern(paragraphXml: string): string {
    const tokens: string[] = [];
    const tokenRegex =
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:instrText(?:\s[^>]*)?>\s*PAGE\s*(?:\\\*\s*MERGEFORMAT)?\s*<\/w:instrText>/gi;
    let tokenMatch: RegExpExecArray | null;

    while ((tokenMatch = tokenRegex.exec(paragraphXml))) {
      if (/^<w:instrText/i.test(tokenMatch[0])) {
        tokens.push('{page}');
        continue;
      }
      tokens.push(this.decodeXmlText(tokenMatch[1] ?? ''));
    }

    const pattern = tokens.join('').replace(/\s+/g, ' ').trim();
    return pattern || '{page}';
  }

  private extractPageProfile(documentXml: string) {
    const pageSize = /<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"[^>]*\/?>/.exec(documentXml);
    const pageMargin =
      /<w:pgMar[^>]*w:top="(\d+)"[^>]*w:right="(\d+)"[^>]*w:bottom="(\d+)"[^>]*w:left="(\d+)"/.exec(
        documentXml,
      );
    const orientation = /<w:pgSz[^>]*w:orient="([^"]+)"/.exec(documentXml)?.[1];

    return {
      widthTwip: pageSize ? Number(pageSize[1]) : null,
      heightTwip: pageSize ? Number(pageSize[2]) : null,
      widthCm: pageSize ? this.twipToCm(pageSize[1]) : null,
      heightCm: pageSize ? this.twipToCm(pageSize[2]) : null,
      marginTopTwip: pageMargin ? Number(pageMargin[1]) : null,
      marginRightTwip: pageMargin ? Number(pageMargin[2]) : null,
      marginBottomTwip: pageMargin ? Number(pageMargin[3]) : null,
      marginLeftTwip: pageMargin ? Number(pageMargin[4]) : null,
      marginTopCm: pageMargin ? this.twipToCm(pageMargin[1]) : null,
      marginRightCm: pageMargin ? this.twipToCm(pageMargin[2]) : null,
      marginBottomCm: pageMargin ? this.twipToCm(pageMargin[3]) : null,
      marginLeftCm: pageMargin ? this.twipToCm(pageMargin[4]) : null,
      orientation: orientation || null,
      paper: pageSize && this.isA4(Number(pageSize[1]), Number(pageSize[2])) ? 'A4' : null,
    };
  }

  private extractFontProfile(documentXml: string, stylesXml: string) {
    const source = `${stylesXml}\n${documentXml}`;
    const families = new Set<string>();

    const fontRegex = /w:(?:ascii|eastAsia|hAnsi|cs)="([^"]+)"/g;
    let fontMatch: RegExpExecArray | null;

    while ((fontMatch = fontRegex.exec(source))) {
      const font = fontMatch[1]?.trim();
      if (font) families.add(font);
    }

    const fontSizes: number[] = [];
    const sizeRegex = /<w:sz(?:\s[^>]*)?w:val="(\d+)"/g;
    let sizeMatch: RegExpExecArray | null;

    while ((sizeMatch = sizeRegex.exec(source))) {
      const halfPt = Number(sizeMatch[1]);
      if (Number.isFinite(halfPt)) fontSizes.push(halfPt / 2);
    }

    const detectedFamilies = Array.from(families).slice(0, 50);

    return {
      detectedFamilies,
      dominantFontFamily: detectedFamilies[0] || null,
      dominantFontSizePt: this.mode(fontSizes) ?? null,
      titleFontFamily: detectedFamilies.find((item) => /标宋|小标宋|方正/i.test(item)) || null,
      headingFontFamily: detectedFamilies.find((item) => /黑体|SimHei/i.test(item)) || null,
      bodyFontFamily:
        detectedFamilies.find((item) => /仿宋|FangSong/i.test(item)) ||
        detectedFamilies[0] ||
        null,
      numberFontFamily: detectedFamilies.find((item) => /Times New Roman/i.test(item)) || null,
    };
  }

  private extractParagraphStyles(documentXml: string, stylesXml: string): DocxParagraphStyle[] {
    const paragraphs: DocxParagraphStyle[] = [];
    const blocks = this.matchXmlBlocks(documentXml, 'w:p');

    blocks.forEach((paragraphXml, index) => {
      const text = this.extractParagraphText(paragraphXml);
      if (!text.trim()) return;

      const styleId = /<w:pStyle[^>]*w:val="([^"]+)"/.exec(paragraphXml)?.[1] ?? null;
      const styleXml = styleId ? this.findStyleXml(stylesXml, styleId) : '';
      const mergedXml = `${styleXml}\n${paragraphXml}`;

      const fontFamily =
        /w:eastAsia="([^"]+)"/.exec(mergedXml)?.[1] ??
        /w:ascii="([^"]+)"/.exec(mergedXml)?.[1] ??
        null;

      const fontSizeHalfPt = /<w:sz[^>]*w:val="(\d+)"/.exec(mergedXml)?.[1];
      const align = /<w:jc[^>]*w:val="([^"]+)"/.exec(mergedXml)?.[1] ?? undefined;
      const firstLine = /<w:ind[^>]*w:firstLine="(\d+)"/.exec(mergedXml)?.[1] ?? undefined;
      const firstLineChars =
        /<w:ind[^>]*w:firstLineChars="(\d+)"/.exec(mergedXml)?.[1] ?? undefined;
      const leftIndent = /<w:ind[^>]*w:left="(\d+)"/.exec(mergedXml)?.[1];
      const rightIndent = /<w:ind[^>]*w:right="(\d+)"/.exec(mergedXml)?.[1];
      const lineSpacing = /<w:spacing[^>]*w:line="(\d+)"/.exec(mergedXml)?.[1];
      const lineRule = /<w:spacing[^>]*w:lineRule="([^"]+)"/.exec(mergedXml)?.[1];
      const beforeSpacing = /<w:spacing[^>]*w:before="(\d+)"/.exec(mergedXml)?.[1];
      const afterSpacing = /<w:spacing[^>]*w:after="(\d+)"/.exec(mergedXml)?.[1];

      const bold = /<w:b(?:\s[^>]*)?\/?>/.test(mergedXml);
      const italic = /<w:i(?:\s[^>]*)?\/?>/.test(mergedXml);

      const isHeading =
        Boolean(styleId && /heading|标题|Title|Heading/i.test(styleId)) ||
        /^第[一二三四五六七八九十]+[章节]/.test(text) ||
        (text.length <= 40 && bold);

      paragraphs.push({
        index,
        textPreview: text.slice(0, 300),
        textLength: text.length,
        align: this.normalizeAlign(align),
        styleName: styleId,
        fontFamily,
        fontSizePt: fontSizeHalfPt ? Number(fontSizeHalfPt) / 2 : null,
        bold,
        italic,
        firstLineIndentPt: firstLine
          ? Number(firstLine) / 20
          : firstLineChars
            ? this.firstLineCharsToPt(firstLineChars)
            : null,
        firstLineIndentCm: firstLine
          ? this.twipToCm(firstLine)
          : firstLineChars
            ? this.firstLineCharsToCm(firstLineChars)
            : null,
        leftIndentPt: leftIndent ? Number(leftIndent) / 20 : null,
        rightIndentPt: rightIndent ? Number(rightIndent) / 20 : null,
        lineSpacingPt: lineSpacing ? Number(lineSpacing) / 20 : null,
        lineRule: this.normalizeLineRule(lineRule, lineSpacing),
        lineSpacingMultiple:
          lineRule === 'auto' && lineSpacing ? Number((Number(lineSpacing) / 240).toFixed(2)) : null,
        spacingBeforePt: beforeSpacing ? Number(beforeSpacing) / 20 : null,
        spacingAfterPt: afterSpacing ? Number(afterSpacing) / 20 : null,
        isHeading,
        headingLevel: isHeading ? this.inferHeadingLevel(text, styleId) : null,
      });
    });

    return paragraphs.slice(0, 500);
  }

  private summarizeParagraphs(paragraphs: DocxParagraphStyle[]) {
    const bodyParagraphs = paragraphs.filter((item) => !item.isHeading);
    const source = bodyParagraphs.length ? bodyParagraphs : paragraphs;

    return {
      total: paragraphs.length,
      alignments: this.countBy(paragraphs.map((item) => item.align).filter(Boolean)),
      fontFamilies: this.countBy(source.map((item) => item.fontFamily).filter(Boolean)),
      fontSizes: this.countBy(
        source
          .map((item) => item.fontSizePt)
          .filter((item) => item !== null && item !== undefined)
          .map(String),
      ),
      firstLineIndentPt: this.modeNumber(source.map((item) => item.firstLineIndentPt)),
      firstLineIndentCm: this.modeNumber(source.map((item) => item.firstLineIndentCm)),
      lineSpacingPt: this.modeNumber(source.map((item) => item.lineSpacingPt)),
      lineRules: this.countBy(source.map((item) => item.lineRule).filter(Boolean)),
      lineSpacingMultiple: this.modeNumber(source.map((item) => item.lineSpacingMultiple)),
      spacingBeforePt: this.modeNumber(source.map((item) => item.spacingBeforePt)),
      spacingAfterPt: this.modeNumber(source.map((item) => item.spacingAfterPt)),
    };
  }

  private extractTableStyleProfile(documentXml: string) {
    const tableBlocks = this.matchXmlBlocks(documentXml, 'w:tbl');

    return tableBlocks.slice(0, 50).map((tableXml, index) => {
      const rowCount = (tableXml.match(/<w:tr(?:\s|>)/g) || []).length;
      const cellCount = (tableXml.match(/<w:tc(?:\s|>)/g) || []).length;
      const hasBorders = /<w:tblBorders[\s\S]*?<\/w:tblBorders>/.test(tableXml);
      const alignment = /<w:jc[^>]*w:val="([^"]+)"/.exec(tableXml)?.[1] ?? null;

      return {
        index,
        rowCount,
        columnCount: rowCount ? Math.round(cellCount / rowCount) : cellCount,
        hasBorders,
        alignment,
      };
    });
  }

  private extractDrawingProfile(documentXml: string) {
    const lineCount = (documentXml.match(/<a:ln(?:\s|>)/g) || []).length;
    const imageCount = (documentXml.match(/<pic:pic(?:\s|>)/g) || []).length;
    const drawingCount = (documentXml.match(/<w:drawing(?:\s|>)/g) || []).length;

    return {
      count: drawingCount,
      lines: lineCount > 0 ? [{ count: lineCount }] : [],
      images: imageCount > 0 ? [{ count: imageCount }] : [],
      shapes: [],
    };
  }

  private buildTemplateProfile(input: {
    text: string;
    sections: ParsedDocument['sections'];
    tables: ParsedDocument['tables'];
    styleProfile: XmlRecord;
    layoutAst: XmlRecord;
    explicitHints: XmlRecord;
    input: ParseDocumentInput;
  }) {
    const explicit = input.explicitHints;
    const style = input.styleProfile;

    return {
      source: 'docx_parser',
      parserVersion: 'docx-structured-style',
      extractedAt: new Date().toISOString(),
      documentKind: 'docx',
      assetRole: input.input.assetRole ?? 'general',
      parsePurpose: input.input.parsePurpose ?? 'knowledge',
      structure: {
        hasText: Boolean(input.text.trim()),
        sectionCount: input.sections?.length ?? 0,
        sectionTitles: (input.sections ?? []).map((item) => item.title).filter(Boolean).slice(0, 80),
        tableCount: input.tables?.length ?? 0,
        tables: (input.tables ?? []).map((table, index) => ({
          index,
          title: table.title,
          headers: table.headers,
          rowCount: table.rows.length,
          columnProfiles: table.columnProfiles,
        })),
      },
      style: {
        page: {
          ...this.asRecord(style.page),
          ...this.compactNulls(this.asRecord(explicit.page)),
        },
        fonts: {
          ...this.asRecord(style.fonts),
          ...this.compactNulls(this.asRecord(explicit.theme)),
        },
        paragraph: {
          ...this.asRecord(style.paragraphSummary),
          ...this.compactNulls(this.asRecord(explicit.paragraph)),
        },
        paragraphSummary: style.paragraphSummary ?? {},
        paragraphs: style.paragraphs,
        tableStyle: style.tables,
        drawings: style.drawings,
        pageNumber: style.pageNumber,
      },
      layoutAst: input.layoutAst,
      explicitHints: explicit,
      rendererHints: this.buildRendererHints({
        explicitHints: explicit,
        assetRole: input.input.assetRole ?? 'general',
        style: {
          page: {
            ...this.asRecord(style.page),
            ...this.compactNulls(this.asRecord(explicit.page)),
          },
          fonts: {
            ...this.asRecord(style.fonts),
            ...this.compactNulls(this.asRecord(explicit.theme)),
          },
          paragraph: {
            ...this.asRecord(style.paragraphSummary),
            ...this.compactNulls(this.asRecord(explicit.paragraph)),
          },
          paragraphSummary: style.paragraphSummary ?? {},
          pageNumber: style.pageNumber,
        },
      }),
      promptHints: {
        constraints: this.buildPromptConstraints(explicit),
      },
    };
  }

  private buildRendererHints(profile: XmlRecord): Record<string, unknown> {
    const style = this.asRecord(profile.style);
    const explicitHints = this.asRecord(profile.explicitHints);
    const matched = this.asRecord(explicitHints.matched);
    const page = this.asRecord(style.page);
    const fonts = this.asRecord(style.fonts);
    const paragraph = this.asRecord(style.paragraph);
    const paragraphSummary = this.asRecord(style.paragraphSummary);
    const pageNumber = this.asRecord(style.pageNumber);
    const mergedParagraph = { ...paragraphSummary, ...paragraph };

    return {
      officialDocument: matched.hasOfficialDocKeyword === true,
      suppressAutoTitle: matched.hasOfficialDocKeyword === true,
      page: {
        paper: page.paper ?? null,
        marginTopCm: this.numberOrNull(page.marginTopCm),
        marginBottomCm: this.numberOrNull(page.marginBottomCm),
        marginLeftCm: this.numberOrNull(page.marginLeftCm),
        marginRightCm: this.numberOrNull(page.marginRightCm),
      },
      paragraph: {
        lineSpacingPt: this.numberOrNull(mergedParagraph.lineSpacingPt),
        lineRule: this.firstString(mergedParagraph.lineRule) ?? null,
        lineRules: this.asRecord(mergedParagraph.lineRules),
        lineSpacingMultiple: this.numberOrNull(mergedParagraph.lineSpacingMultiple),
        firstLineIndentCm: this.numberOrNull(mergedParagraph.firstLineIndentCm),
        firstLineIndentPt: this.numberOrNull(mergedParagraph.firstLineIndentPt),
        fontSizePt:
          this.numberOrNull(mergedParagraph.fontSizePt) ??
          this.numberOrNull(fonts.fontSizePt) ??
          this.numberOrNull(fonts.dominantFontSizePt),
        align: mergedParagraph.align ?? 'justify',
      },
      title: {
        fontFamily: fonts.titleFontFamily ?? null,
        fontSizePt:
          this.numberOrNull(fonts.titleFontSizePt) ??
          this.numberOrNull(this.asRecord(explicitHints.theme).titleFontSizePt) ??
          22,
        align: 'center',
        bold: true,
      },
      heading: {
        fontFamily: fonts.headingFontFamily ?? null,
        fontSizePt:
          this.numberOrNull(fonts.headingFontSizePt) ??
          this.numberOrNull(fonts.dominantFontSizePt) ??
          16,
      },
      fonts: {
        fontFamily: fonts.bodyFontFamily ?? fonts.dominantFontFamily ?? null,
        titleFontFamily: fonts.titleFontFamily ?? null,
        headingFontFamily: fonts.headingFontFamily ?? null,
        numberFontFamily: fonts.numberFontFamily ?? null,
        fontSizePt: this.numberOrNull(fonts.dominantFontSizePt),
      },
      footer: {
        showPageNumber: pageNumber.enabled === true,
        align: this.normalizeHeaderFooterAlign(pageNumber.align) ?? 'center',
        text: this.firstString(pageNumber.textPattern) ?? undefined,
        fontFamily: this.firstString(pageNumber.fontFamily) ?? undefined,
        fontSizePt: this.numberOrNull(pageNumber.fontSizePt) ?? undefined,
      },
    };
  }

  private extractParagraphText(paragraphXml: string): string {
    const tokens: string[] = [];
    const tokenRegex =
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab(?:\s[^>]*)?\/>|<w:br(?:\s[^>]*)?\/>/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(paragraphXml))) {
      const raw = match[0];
      if (/^<w:tab/i.test(raw)) {
        tokens.push('\t');
        continue;
      }
      if (/^<w:br/i.test(raw)) {
        tokens.push('\n');
        continue;
      }
      tokens.push(this.decodeXmlText(match[1] ?? ''));
    }

    return tokens.join('').replace(/\u0000/g, '').trim();
  }

  private matchXmlBlocks(xml: string, tagName: string): string[] {
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, 'g');
    return xml.match(regex) || [];
  }

  private findStyleXml(stylesXml: string, styleId: string): string {
    if (!stylesXml || !styleId) return '';

    const escaped = styleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<w:style[^>]*w:styleId="${escaped}"[\\s\\S]*?<\\/w:style>`,
      'i',
    );

    return regex.exec(stylesXml)?.[0] ?? '';
  }

  private extractExplicitTemplateHints(text: string) {
    const source = String(text || '');

    const fontFamily =
      this.matchFirst(source, [
        /正文[^。\n]*?(仿宋_GB2312|仿宋|FangSong)/i,
        /(仿宋_GB2312|仿宋|FangSong)/i,
      ]) ?? null;

    const titleFontFamily =
      this.matchFirst(source, [
        /标题[^。\n]*?(方正小标宋简体|小标宋|标宋)/i,
        /(方正小标宋简体|小标宋|标宋)/i,
      ]) ?? null;

    const headingFontFamily =
      this.matchFirst(source, [/一级标题[^。\n]*?(黑体|SimHei)/i, /(黑体|SimHei)/i]) ??
      null;

    const fontSizePt =
      this.detectChineseFontSize(source, ['三号', '3号']) ??
      this.matchNumberBefore(source, /磅|pt/i);

    const titleFontSizePt = this.detectChineseFontSize(source, ['二号', '2号']) ?? null;

    const lineSpacingPt =
      this.matchNumberIn(source, /(\d+(?:\.\d+)?)\s*磅行距/) ??
      this.matchNumberIn(source, /行距[^0-9]{0,8}(\d+(?:\.\d+)?)\s*磅/);

    const firstLineIndentCm =
      /首行缩进[^。\n]*?(二字|2字|两个字符|2个字符)/.test(source) ? 1.12 : null;

    const page = {
      paper: /A4/i.test(source) ? 'A4' : null,
      marginTopCm: this.matchNumberIn(source, /上(?:边距)?[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(?:cm|厘米)/i),
      marginBottomCm: this.matchNumberIn(source, /下(?:边距)?[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(?:cm|厘米)/i),
      marginLeftCm: this.matchNumberIn(source, /左(?:边距)?[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(?:cm|厘米)/i),
      marginRightCm: this.matchNumberIn(source, /右(?:边距)?[^0-9]{0,6}(\d+(?:\.\d+)?)\s*(?:cm|厘米)/i),
    };

    return {
      source: 'docx_text_annotations',
      matched: {
        hasA4: /A4/i.test(source),
        hasOfficialDocKeyword: /公文|请示|报告|通知|函|市委办|党政机关/.test(source),
        hasFontHint: Boolean(fontFamily || titleFontFamily || headingFontFamily),
        hasSpacingHint: Boolean(lineSpacingPt),
        hasIndentHint: Boolean(firstLineIndentCm),
      },
      page,
      theme: {
        fontFamily,
        titleFontFamily,
        headingFontFamily,
        numberFontFamily: /Times New Roman/i.test(source) ? 'Times New Roman' : null,
        fontSizePt,
        titleFontSizePt,
      },
      paragraph: {
        lineSpacingPt,
        firstLineIndentCm,
        fontSizePt,
        align: /两端对齐|justify/.test(source) ? 'justify' : null,
      },
    };
  }

  private buildPromptConstraints(explicitHints: XmlRecord): string[] {
    const constraints: string[] = [];
    const matched = this.asRecord(explicitHints.matched);
    const theme = this.asRecord(explicitHints.theme);
    const paragraph = this.asRecord(explicitHints.paragraph);

    if (matched.hasA4) constraints.push('Use A4 page size.');
    if (theme.fontFamily) constraints.push(`Prefer ${String(theme.fontFamily)} for body text.`);
    if (theme.titleFontFamily) constraints.push(`Prefer ${String(theme.titleFontFamily)} for titles.`);
    if (paragraph.lineSpacingPt) constraints.push(`Prefer ${String(paragraph.lineSpacingPt)} pt body line spacing.`);
    if (paragraph.firstLineIndentCm) constraints.push('Preserve the detected first-line paragraph indentation.');

    return constraints;
  }

  private normalizeHeaders(headers: string[]): string[] {
    const seen = new Map<string, number>();

    return headers.map((header, index) => {
      const base = String(header || `Column ${index + 1}`).trim() || `Column ${index + 1}`;
      const used = seen.get(base) ?? 0;
      seen.set(base, used + 1);
      return used === 0 ? base : `${base}_${used + 1}`;
    });
  }

  private decodeXmlText(value: string): string {
    return String(value || '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  private normalizeAlign(value: unknown): string | undefined {
    const raw = String(value || '').toLowerCase();
    if (raw === 'center') return 'center';
    if (raw === 'right') return 'right';
    if (raw === 'both' || raw === 'distribute' || raw === 'justify') return 'justify';
    if (raw === 'left') return 'left';
    return undefined;
  }

  private normalizeLineRule(
    value: unknown,
    lineSpacing?: string | number,
  ): 'single' | '1.5' | 'double' | 'multiple' | 'exact' | 'atLeast' | undefined {
    const raw = String(value || '').toLowerCase();

    if (raw === 'exact') return 'exact';
    if (raw === 'atleast') return 'atLeast';

    if (raw === 'auto') {
      const multiple = Number(lineSpacing) / 240;
      if (Math.abs(multiple - 1) < 0.05) return 'single';
      if (Math.abs(multiple - 1.5) < 0.05) return '1.5';
      if (Math.abs(multiple - 2) < 0.05) return 'double';
      return 'multiple';
    }

    return undefined;
  }

  private inferHeadingLevel(text: string, styleId?: string | null): number | null {
    const raw = `${styleId || ''} ${text}`;
    if (/heading1|标题1|一级/i.test(raw)) return 1;
    if (/heading2|标题2|二级/i.test(raw)) return 2;
    if (/heading3|标题3|三级/i.test(raw)) return 3;
    return null;
  }

  private isA4(widthTwip: number, heightTwip: number): boolean {
    const w = Math.min(widthTwip, heightTwip);
    const h = Math.max(widthTwip, heightTwip);
    return Math.abs(w - 11906) < 100 && Math.abs(h - 16838) < 100;
  }

  private twipToCm(value: string | number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number((n / 567).toFixed(2));
  }

  private firstLineCharsToPt(value: string | number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(((n / 100) * 16).toFixed(2));
  }

  private firstLineCharsToCm(value: string | number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(((n / 100) * 0.56).toFixed(2));
  }

  private mode(values: number[]): number | undefined {
    if (!values.length) return undefined;
    const counts = new Map<number, number>();

    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  private modeNumber(values: unknown[]): number | null {
    const nums = values.map(Number).filter((item) => Number.isFinite(item));
    return this.mode(nums) ?? null;
  }

  private countBy(values: unknown[]): Record<string, number> {
    const result: Record<string, number> = {};

    for (const value of values) {
      const key = String(value ?? '').trim();
      if (!key) continue;
      result[key] = (result[key] ?? 0) + 1;
    }

    return result;
  }

  private detectChineseFontSize(source: string, names: string[]): number | null {
    const map: Record<string, number> = {
      初号: 42,
      小初: 36,
      一号: 26,
      小一: 24,
      二号: 22,
      小二: 18,
      三号: 16,
      小三: 15,
      四号: 14,
      小四: 12,
      五号: 10.5,
      小五: 9,
      六号: 7.5,
      小六: 6.5,
      七号: 5.5,
      八号: 5,
    };

    for (const name of names) {
      if (source.includes(name)) return map[name] ?? null;
    }

    return null;
  }

  private fontSizePtToChineseLabel(value: number | null): string | null {
    if (value === null || value === undefined) return null;

    const entries: Array<[string, number]> = [
      ['初号', 42],
      ['小初', 36],
      ['一号', 26],
      ['小一', 24],
      ['二号', 22],
      ['小二', 18],
      ['三号', 16],
      ['小三', 15],
      ['四号', 14],
      ['小四', 12],
      ['五号', 10.5],
      ['小五', 9],
      ['六号', 7.5],
      ['小六', 6.5],
      ['七号', 5.5],
      ['八号', 5],
    ];

    const matched = entries.find(([, pt]) => Math.abs(pt - value) < 0.15);
    return matched?.[0] ?? null;
  }

  private matchFirst(source: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
      const matched = pattern.exec(source)?.[1];
      if (matched) return matched.trim();
    }
    return undefined;
  }

  private matchNumberIn(source: string, pattern: RegExp): number | null {
    const value = pattern.exec(source)?.[1];
    if (!value) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private matchNumberBefore(source: string, unitPattern: RegExp): number | null {
    const escaped = unitPattern.source;
    const match = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${escaped}`, 'i').exec(source);
    const n = Number(match?.[1]);
    return Number.isFinite(n) ? n : null;
  }

  private compactNulls(value: unknown): XmlRecord {
    const record = this.asRecord(value);
    const result: XmlRecord = {};

    for (const [key, item] of Object.entries(record)) {
      if (item !== null && item !== undefined && item !== '') result[key] = item;
    }

    return result;
  }

  private numberOrNull(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private asRecord(value: unknown): XmlRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as XmlRecord;
  }

  private normalizeHeaderFooterAlign(value: unknown): 'left' | 'center' | 'right' | undefined {
    const align = this.normalizeAlign(value);
    if (align === 'left' || align === 'center' || align === 'right') return align;
    return undefined;
  }

  private firstString(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'string') return v;
      }
    }
    return undefined;
  }
}
