import { BadRequestException, Injectable } from '@nestjs/common';
import * as path from 'node:path';
import { DocumentParserRegistry } from './document-parser.registry';
import {
  ParseDocumentInput,
  ParsedDocument,
  ParsedDocumentParagraphStyle,
  ParsedDocumentStyleProfile,
  ParsedDocumentTable,
  ParsedDocumentTableColumnProfile,
} from './document.types';

export const DOCUMENT_PARSER_MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  zip: 'application/zip',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  js: 'text/javascript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  java: 'text/x-java-source',
  go: 'text/x-go',
  rs: 'text/x-rust',
  vue: 'text/x-vue',
  css: 'text/css',
  scss: 'text/x-scss',
  sql: 'application/sql',
  prisma: 'text/plain',
  yaml: 'application/yaml',
  yml: 'application/yaml',
});

@Injectable()
export class DocumentParserService {
  readonly maxFileSizeBytes = DOCUMENT_PARSER_MAX_FILE_SIZE_BYTES;

  constructor(private readonly registry: DocumentParserRegistry) {}

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    if (!Buffer.isBuffer(input.buffer)) {
      throw new BadRequestException({ code: 'DOCUMENT_BUFFER_INVALID', message: 'DOCUMENT_BUFFER_INVALID' });
    }

    if (input.buffer.length === 0) {
      throw new BadRequestException({ code: 'DOCUMENT_EMPTY', message: 'DOCUMENT_EMPTY' });
    }

    if (input.buffer.length > this.maxFileSizeBytes) {
      throw new BadRequestException({ code: 'DOCUMENT_PARSE_SIZE_LIMIT', message: 'DOCUMENT_PARSE_SIZE_LIMIT', params: { maxMb: 30 } });
    }

    const normalized = this.normalizeInput(input);
    const parser = this.registry.resolve(normalized);
    const parsed = await parser.parse(normalized);

    if (!parsed || typeof parsed !== 'object' || typeof parsed.text !== 'string') {
      throw new BadRequestException({ code: 'DOCUMENT_PARSER_INVALID_RESULT', message: 'DOCUMENT_PARSER_INVALID_RESULT', params: { parserKind: parser.kind } });
    }

    const sections = this.normalizeSections(parsed.sections);
    const tables = this.normalizeTables(parsed.tables);
    const styleProfile = parsed.styleProfile
      ? this.normalizeStyleProfile(parsed.styleProfile, parser.version)
      : undefined;
    const layoutAst = this.normalizeRecord(parsed.layoutAst);
    const parserVersion = this.firstText(
      this.asRecord(parsed.meta).parserVersion,
      parser.version,
      parser.kind,
    );

    return {
      ...parsed,
      kind: parser.kind,
      text: this.normalizeText(parsed.text),
      sections,
      tables,
      ...(styleProfile ? { styleProfile } : {}),
      ...(layoutAst ? { layoutAst } : {}),
      meta: {
        ...this.asRecord(parsed.meta),
        objectName: normalized.objectName,
        mimeType: normalized.mimeType,
        extension: normalized.extension,
        source: normalized.source ?? 'unknown',
        parser: parser.kind,
        parserVersion,
        hasSections: sections.length > 0,
        hasTables: tables.length > 0,
        hasStyleProfile: Boolean(styleProfile),
        hasLayoutAst: Boolean(layoutAst),
        parsedAt: new Date().toISOString(),
      },
    };
  }

  listSupported() {
    return this.registry.listSupported();
  }

  private normalizeInput(input: ParseDocumentInput): ParseDocumentInput {
    const objectName = String(input.objectName || 'file').trim() || 'file';
    const suppliedExtension = String(input.extension ?? '').trim().toLowerCase().replace(/^\./, '');
    const inferredExtension = path.extname(objectName).slice(1).toLowerCase();
    const extension = suppliedExtension || inferredExtension || null;
    const suppliedMimeType = String(input.mimeType ?? '').trim().toLowerCase();
    const mimeType = suppliedMimeType
      || (extension ? MIME_BY_EXTENSION[extension] : undefined)
      || 'application/octet-stream';

    return {
      ...input,
      objectName,
      mimeType,
      extension,
      source: String(input.source || 'unknown').trim() || 'unknown',
    };
  }

  private normalizeText(text: string): string {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '')
      .trim();
  }

  private normalizeSections(sections: ParsedDocument['sections']): NonNullable<ParsedDocument['sections']> {
    if (!Array.isArray(sections)) return [];

    return sections
      .filter((section) => section && typeof section === 'object')
      .map((section, index) => ({
        title: this.cleanOptionalText(section.title),
        content: this.normalizeText(section.content),
        level: this.clampNumber(section.level, 1, 6, 1),
        meta: {
          ...this.asRecord(section.meta),
          index,
        },
      }))
      .filter((section) => Boolean(section.title || section.content));
  }

  private normalizeTables(tables: ParsedDocument['tables']): ParsedDocumentTable[] {
    if (!Array.isArray(tables)) return [];

    return tables
      .filter((table) => table && typeof table === 'object')
      .map((table, index) => ({
        sheetName: this.cleanOptionalText(table.sheetName),
        title: this.cleanOptionalText(table.title),
        headers: Array.isArray(table.headers)
          ? table.headers.map((item) => String(item ?? '').trim())
          : [],
        rows: this.normalizeRows(table.rows),
        rawRows: this.normalizeRawRows(table.rawRows),
        headerRowIndex: this.clampNumber(table.headerRowIndex, 0, 100000, 0),
        columnProfiles: this.normalizeColumnProfiles(table.columnProfiles),
        meta: {
          ...this.asRecord(table.meta),
          index,
        },
      }))
      .filter((table) => (
        table.headers.length > 0
        || table.rows.length > 0
        || table.rawRows.length > 0
      ));
  }

  private normalizeRows(value: unknown): Array<Record<string, string>> {
    if (!Array.isArray(value)) return [];
    return value
      .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
      .map((row) => Object.fromEntries(
        Object.entries(row as Record<string, unknown>)
          .map(([key, cell]) => [String(key), String(cell ?? '')]),
      ));
  }

  private normalizeRawRows(value: unknown): string[][] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(Array.isArray)
      .map((row) => row.map((cell) => String(cell ?? '')));
  }

  private normalizeColumnProfiles(value: unknown): ParsedDocumentTableColumnProfile[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => {
        const profile = item as Record<string, unknown>;
        const inferredType = String(profile.inferredType ?? 'mixed');
        return {
          index: this.clampNumber(profile.index, 0, 100000, 0),
          header: String(profile.header ?? '').trim(),
          inferredType: ['empty', 'text', 'number', 'date', 'boolean', 'mixed'].includes(inferredType)
            ? inferredType as ParsedDocumentTableColumnProfile['inferredType']
            : 'mixed',
          nonEmptyCount: this.clampNumber(profile.nonEmptyCount, 0, 10000000, 0),
          emptyCount: this.clampNumber(profile.emptyCount, 0, 10000000, 0),
          uniqueCount: this.clampNumber(profile.uniqueCount, 0, 10000000, 0),
        };
      });
  }

  private normalizeStyleProfile(
    value: ParsedDocumentStyleProfile,
    parserVersion: string,
  ): ParsedDocumentStyleProfile {
    const profile = this.asRecord(value);
    const fonts = this.asRecord(profile.fonts);
    const paragraphSummary = this.asRecord(profile.paragraphSummary);
    const paragraphs = Array.isArray(profile.paragraphs)
      ? profile.paragraphs
          .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
          .map((item) => this.normalizeParagraphStyle(item as JsonRecord))
      : [];
    const tableStyles = Array.isArray(profile.tables)
      ? profile.tables
          .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
          .map((item, index) => {
            const record = item as JsonRecord;
            return {
              index: this.clampNumber(record.index, 0, 100000, index),
              rowCount: this.clampNumber(record.rowCount, 0, 1000000, 0),
              columnCount: this.clampNumber(record.columnCount, 0, 100000, 0),
              hasBorders: this.booleanOrNull(record.hasBorders),
              alignment: this.cleanOptionalText(record.alignment) ?? null,
            };
          })
      : [];

    return {
      parserVersion: this.firstText(profile.parserVersion, parserVersion),
      source: this.cleanOptionalText(profile.source) ?? 'parser',
      confidence: this.clampFloat(profile.confidence, 0, 1, 0),
      page: this.normalizeRecord(profile.page),
      fonts: {
        ...fonts,
        detectedFamilies: Array.isArray(fonts.detectedFamilies)
          ? fonts.detectedFamilies.map((item) => String(item ?? '').trim()).filter(Boolean)
          : [],
      },
      paragraphs,
      paragraphSummary: {
        ...paragraphSummary,
        total: this.clampNumber(paragraphSummary.total, 0, 1000000, paragraphs.length),
        alignments: this.asNumberRecord(paragraphSummary.alignments),
        fontFamilies: this.asNumberRecord(paragraphSummary.fontFamilies),
        fontSizes: this.asNumberRecord(paragraphSummary.fontSizes),
      },
      tables: tableStyles,
      drawings: this.normalizeRecord(profile.drawings) ?? {},
      pageNumber: this.normalizeRecord(profile.pageNumber) ?? {},
      raw: this.normalizeRecord(profile.raw) ?? {},
    };
  }

  private normalizeParagraphStyle(value: JsonRecord): ParsedDocumentParagraphStyle {
    return {
      index: this.clampNumber(value.index, 0, 100000, 0),
      textPreview: this.normalizeText(String(value.textPreview ?? '')).slice(0, 300),
      textLength: this.clampNumber(value.textLength, 0, 1000000, 0),
      align: this.cleanOptionalText(value.align),
      styleName: this.cleanOptionalText(value.styleName) ?? null,
      fontFamily: this.cleanOptionalText(value.fontFamily) ?? null,
      fontSizePt: this.numberOrNull(value.fontSizePt),
      bold: this.booleanOrNull(value.bold),
      italic: this.booleanOrNull(value.italic),
      firstLineIndentPt: this.numberOrNull(value.firstLineIndentPt),
      firstLineIndentCm: this.numberOrNull(value.firstLineIndentCm),
      leftIndentPt: this.numberOrNull(value.leftIndentPt),
      rightIndentPt: this.numberOrNull(value.rightIndentPt),
      lineSpacingPt: this.numberOrNull(value.lineSpacingPt),
      lineRule: this.cleanOptionalText(value.lineRule) ?? null,
      lineSpacingMultiple: this.numberOrNull(value.lineSpacingMultiple),
      spacingBeforePt: this.numberOrNull(value.spacingBeforePt),
      spacingAfterPt: this.numberOrNull(value.spacingAfterPt),
      isHeading: this.booleanOrNull(value.isHeading) ?? false,
      headingLevel: this.numberOrNull(value.headingLevel),
    };
  }

  private normalizeRecord(value: unknown): JsonRecord | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as JsonRecord;
  }

  private asRecord(value: unknown): JsonRecord {
    return this.normalizeRecord(value) ?? {};
  }

  private asNumberRecord(value: unknown): Record<string, number> {
    const record = this.asRecord(value);
    return Object.fromEntries(
      Object.entries(record)
        .map(([key, count]) => [key, Number(count)])
        .filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    );
  }

  private firstText(...values: unknown[]): string {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
    return 'unknown';
  }

  private cleanOptionalText(value: unknown): string | undefined {
    const text = String(value ?? '').trim();
    return text || undefined;
  }

  private numberOrNull(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private booleanOrNull(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return null;
  }

  private clampFloat(value: unknown, min: number, max: number, fallback: number): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(number)));
  }
}
