                                                            

import { BadRequestException, Injectable } from '@nestjs/common';
import { ParseDocumentInput, ParsedDocument, ParsedDocumentTable } from '../document.types';
import { DocumentParser } from './document-parser.interface';

const MAX_PARSED_ROWS = 10_000;
const MAX_COLUMNS = 500;
const MAX_FIELD_CHARACTERS = 1_000_000;
const STRUCTURED_PREVIEW_ROWS = 200;

@Injectable()
export class CsvDocumentParser implements DocumentParser {
  readonly kind = 'csv' as const;
  readonly version = '2.0.0';

  readonly support = {
    mimeTypes: ['text/csv', 'application/csv', 'text/tab-separated-values'],
    extensions: ['csv', 'tsv'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();
    return (
      this.support.extensions.includes(ext || '')
      || this.support.mimeTypes.includes(input.mimeType || '')
    );
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    const text = input.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const delimiter = input.extension?.toLowerCase() === 'tsv'
      ? '\t'
      : this.detectDelimiter(text);
    const parsed = this.parseDelimited(text, delimiter);
    const rawRows = parsed.rows.filter((row) => row.some((cell) => cell.length > 0));

    if (!rawRows.length) {
      throw new BadRequestException({ code: 'DOCUMENT_CSV_EMPTY', message: 'DOCUMENT_CSV_EMPTY', params: { objectName: input.objectName } });
    }

    const headers = this.normalizeHeaders(rawRows[0] ?? []);
    const sourceRows = rawRows.slice(1, STRUCTURED_PREVIEW_ROWS + 1);
    const rows = sourceRows.map((row) => Object.fromEntries(
      headers.map((header, index) => [header, row[index] ?? '']),
    ));

    const table: ParsedDocumentTable = {
      title: input.objectName,
      headers,
      rows,
      rawRows: rawRows.slice(0, STRUCTURED_PREVIEW_ROWS + 1),
      headerRowIndex: 0,
      columnProfiles: headers.map((header, index) => {
        const values = sourceRows.map((row) => row[index] ?? '');
        const nonEmpty = values.filter((value) => value.trim().length > 0);
        return {
          index,
          header,
          inferredType: 'text' as const,
          nonEmptyCount: nonEmpty.length,
          emptyCount: values.length - nonEmpty.length,
          uniqueCount: new Set(nonEmpty).size,
        };
      }),
      meta: {
        rowCount: Math.max(0, rawRows.length - 1),
        parsedRowCount: rows.length,
        columnCount: headers.length,
        delimiter: delimiter === '\t' ? 'tab' : delimiter,
        truncated: parsed.truncated || rawRows.length > STRUCTURED_PREVIEW_ROWS + 1,
      },
    };

    return {
      text,
      title: input.objectName,
      kind: this.kind,
      mimeType: input.mimeType,
      extension: input.extension,
      sections: [{
        title: 'CSV preview',
        content: rawRows.slice(0, 20).map((row) => row.join(' | ')).join('\n'),
        level: 1,
      }],
      tables: [table],
      meta: {
        parserVersion: 'csv-structured',
        rowCount: Math.max(0, rawRows.length - 1),
        columnCount: headers.length,
        delimiter: delimiter === '\t' ? 'tab' : delimiter,
        truncated: parsed.truncated,
      },
    };
  }

  private parseDelimited(text: string, delimiter: string): { rows: string[][]; truncated: boolean } {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    let truncated = false;

    const pushField = () => {
      if (row.length >= MAX_COLUMNS) {
        throw new BadRequestException({ code: 'DOCUMENT_CSV_COLUMN_LIMIT', message: 'DOCUMENT_CSV_COLUMN_LIMIT', params: { limit: MAX_COLUMNS } });
      }
      row.push(field);
      field = '';
    };

    const pushRow = () => {
      pushField();
      rows.push(row);
      row = [];
      if (rows.length >= MAX_PARSED_ROWS) truncated = true;
    };

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (char === '"') {
        if (quoted && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
        continue;
      }

      if (!quoted && char === delimiter) {
        pushField();
        continue;
      }

      if (!quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        pushRow();
        if (truncated) break;
        continue;
      }

      field += char;
      if (field.length > MAX_FIELD_CHARACTERS) {
        throw new BadRequestException({ code: 'DOCUMENT_CSV_FIELD_LIMIT', message: 'DOCUMENT_CSV_FIELD_LIMIT', params: { limit: MAX_FIELD_CHARACTERS } });
      }
    }

    if (quoted) {
      throw new BadRequestException({ code: 'DOCUMENT_CSV_UNCLOSED_QUOTE', message: 'DOCUMENT_CSV_UNCLOSED_QUOTE' });
    }

    if (!truncated && (field.length > 0 || row.length > 0)) pushRow();
    return { rows, truncated };
  }

  private detectDelimiter(text: string): string {
    const candidates = [',', ';', '\t'];
    const counts = new Map(candidates.map((candidate) => [candidate, 0]));
    let quoted = false;
    let sampledLines = 0;

    for (let index = 0; index < text.length && sampledLines < 20; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') index += 1;
        else quoted = !quoted;
        continue;
      }
      if (!quoted && (char === '\n' || char === '\r')) {
        sampledLines += 1;
        continue;
      }
      if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
    }

    return candidates.sort((left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0))[0] ?? ',';
  }

  private normalizeHeaders(source: string[]): string[] {
    const used = new Map<string, number>();
    return source.slice(0, MAX_COLUMNS).map((value, index) => {
      const base = value.trim() || `Column ${index + 1}`;
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      return count === 0 ? base : `${base}_${count + 1}`;
    });
  }
}
