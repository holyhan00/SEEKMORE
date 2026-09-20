                                                             

import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  ParseDocumentInput,
  ParsedDocument,
  ParsedDocumentCellType,
  ParsedDocumentTable,
  ParsedDocumentTableColumnProfile,
} from '../document.types';
import { DocumentParser } from './document-parser.interface';
import { inspectZipCentralDirectory, ZipContainerError } from './zip-central-directory.util';


const MAX_SHEETS = 50;
const MAX_ROWS_PER_SHEET = 2_000;
const MAX_COLUMNS_PER_SHEET = 200;

@Injectable()
export class XlsxDocumentParser implements DocumentParser {
  readonly kind = 'xlsx' as const;
  readonly version = '2.0.0';

  readonly support = {
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    extensions: ['xlsx', 'xls'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();
    return (
      this.support.extensions.includes(ext || '') ||
      this.support.mimeTypes.includes(input.mimeType || '')
    );
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    if (input.extension?.toLowerCase() !== 'xls') {
      this.assertSafeContainer(input.buffer);
    }

    const workbook = XLSX.read(input.buffer, {
      type: 'buffer',
      cellDates: true,
      cellText: false,
    });

    const parts: string[] = [];
    const tables: ParsedDocumentTable[] = [];

    const selectedSheetNames = workbook.SheetNames.slice(0, MAX_SHEETS);
    const truncatedSheets = workbook.SheetNames.length > selectedSheetNames.length;

    for (const sheetName of selectedSheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const sourceRange = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
      const boundedRange = sourceRange
        ? {
            s: sourceRange.s,
            e: {
              r: Math.min(sourceRange.e.r, sourceRange.s.r + MAX_ROWS_PER_SHEET - 1),
              c: Math.min(sourceRange.e.c, sourceRange.s.c + MAX_COLUMNS_PER_SHEET - 1),
            },
          }
        : undefined;
      const sheetTruncated = Boolean(sourceRange && boundedRange && (
        boundedRange.e.r < sourceRange.e.r || boundedRange.e.c < sourceRange.e.c
      ));

      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: false,
        ...(boundedRange ? { range: boundedRange } : {}),
      });

      const normalizedRows = rawRows
        .map((row) => row.map((cell) => this.normalizeCell(cell)))
        .filter((row) => row.some((cell) => cell.trim().length > 0));

      if (!normalizedRows.length) {
        parts.push(`# Sheet: ${sheetName}\nEmpty sheet`);
        continue;
      }

      const table = this.buildTable(sheetName, normalizedRows);
      table.meta = { ...table.meta, truncated: sheetTruncated };
      tables.push(table);
      parts.push(this.renderTableAsKnowledgeText(table));
    }

    return {
      text: parts.join('\n\n---\n\n'),
      title: input.objectName,
      kind: this.kind,
      mimeType: input.mimeType,
      extension: input.extension,
      tables,
      meta: {
        sheetNames: selectedSheetNames,
        sheetCount: workbook.SheetNames.length,
        parsedSheetCount: selectedSheetNames.length,
        tableCount: tables.length,
        parserVersion: 'xlsx-structured',
        truncated: truncatedSheets || tables.some((table) => table.meta?.truncated === true),
        limits: {
          maxSheets: MAX_SHEETS,
          maxRowsPerSheet: MAX_ROWS_PER_SHEET,
          maxColumnsPerSheet: MAX_COLUMNS_PER_SHEET,
        },
      },
    };
  }


  private assertSafeContainer(buffer: Buffer): void {
    try {
      inspectZipCentralDirectory(buffer, {
        maxEntries: 10_000,
        maxCentralDirectoryBytes: 24 * 1024 * 1024,
        maxEntryUncompressedBytes: 256 * 1024 * 1024,
        maxTotalUncompressedBytes: 512 * 1024 * 1024,
        maxCompressionRatio: 2_000,
        rejectEncrypted: true,
        rejectUnsafePaths: true,
      });
    } catch (error) {
      if (error instanceof ZipContainerError) {
        throw new BadRequestException({
          code: error.code,
          message: `Unsafe or invalid XLSX container: ${error.message}`,
          details: error.details,
        });
      }
      throw error;
    }
  }

  private buildTable(sheetName: string, rawRows: string[][]): ParsedDocumentTable {
    const headerRowIndex = this.detectHeaderRowIndex(rawRows);
    const titleRows = rawRows.slice(0, headerRowIndex);
    const headerRow = rawRows[headerRowIndex] || [];
    const dataRows = rawRows.slice(headerRowIndex + 1);

    const headers = this.normalizeHeaders(headerRow, rawRows);
    const rows = dataRows
      .map((rawRow) => this.rowToRecord(headers, rawRow))
      .filter((row) => Object.values(row).some((value) => String(value).trim()));

    const columnProfiles = this.buildColumnProfiles(headers, dataRows);

    const title = titleRows
      .map((row) => row.filter(Boolean).join(' '))
      .join(' ')
      .trim();

    return {
      sheetName,
      title: title || sheetName,
      headers,
      rows,
      rawRows,
      headerRowIndex,
      columnProfiles,
      meta: {
        rowCount: rows.length,
        rawRowCount: rawRows.length,
        columnCount: headers.length,
        detection: {
          method: 'structure-statistics',
          headerRowIndex,
        },
      },
    };
  }

     
                
             
          
               
                
               
                    
                      
     
  private detectHeaderRowIndex(rows: string[][]): number {
    if (!rows.length) return 0;
    if (rows.length === 1) return 0;

    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    const maxScanRows = Math.min(rows.length, 12);

    for (let index = 0; index < maxScanRows; index += 1) {
      const row = rows[index] || [];
      const nextRows = rows.slice(index + 1, Math.min(rows.length, index + 8));

      const score = this.scoreHeaderCandidate(row, nextRows, index);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  private scoreHeaderCandidate(
    row: string[],
    nextRows: string[][],
    rowIndex: number,
  ): number {
    const cells = row.map((cell) => cell.trim());
    const nonEmptyCells = cells.filter(Boolean);

    if (!nonEmptyCells.length) return Number.NEGATIVE_INFINITY;

    const nonEmptyRatio = nonEmptyCells.length / Math.max(cells.length, 1);
    const uniqueRatio =
      new Set(nonEmptyCells.map((cell) => cell.toLowerCase())).size /
      Math.max(nonEmptyCells.length, 1);

    const textRatio =
      nonEmptyCells.filter((cell) => this.inferCellType(cell) === 'text').length /
      Math.max(nonEmptyCells.length, 1);

    const currentTypeEntropy = this.typeEntropy(nonEmptyCells);
    const nextTypeStability = this.nextRowsTypeStability(nextRows);
    const nextDataDensity = this.nextRowsDensity(nextRows);

    const currentVsNextDifference = this.currentVsNextTypeDifference(row, nextRows);

       
                            
       
    const positionPenalty = rowIndex * 0.35;

    return (
      nonEmptyRatio * 3.0 +
      uniqueRatio * 2.0 +
      textRatio * 2.0 +
      currentTypeEntropy * 1.2 +
      nextTypeStability * 2.5 +
      nextDataDensity * 1.5 +
      currentVsNextDifference * 1.8 -
      positionPenalty
    );
  }

  private normalizeHeaders(headerRow: string[], allRows: string[][]): string[] {
    const maxColumns = Math.max(
      headerRow.length,
      ...allRows.map((row) => row.length),
      1,
    );

    const seen = new Map<string, number>();

    return Array.from({ length: maxColumns }).map((_, index) => {
      const raw = this.normalizeCell(headerRow[index] ?? '');
      const base = raw || `Column ${index + 1}`;

      const used = seen.get(base) ?? 0;
      seen.set(base, used + 1);

      return used === 0 ? base : `${base}_${used + 1}`;
    });
  }

  private rowToRecord(headers: string[], row: string[]): Record<string, string> {
    const record: Record<string, string> = {};

    headers.forEach((header, index) => {
      record[header] = this.normalizeCell(row[index] ?? '');
    });

    return record;
  }

  private buildColumnProfiles(
    headers: string[],
    dataRows: string[][],
  ): ParsedDocumentTableColumnProfile[] {
    return headers.map((header, index) => {
      const values = dataRows.map((row) => this.normalizeCell(row[index] ?? ''));
      const nonEmpty = values.filter(Boolean);
      const types = nonEmpty.map((value) => this.inferCellType(value));

      return {
        index,
        header,
        inferredType: this.majorityType(types),
        nonEmptyCount: nonEmpty.length,
        emptyCount: values.length - nonEmpty.length,
        uniqueCount: new Set(nonEmpty.map((value) => value.toLowerCase())).size,
      };
    });
  }

  private renderTableAsKnowledgeText(table: ParsedDocumentTable): string {
    const lines: string[] = [];

    lines.push(`# Sheet: ${table.sheetName || 'Sheet'}`);

    if (table.title && table.title !== table.sheetName) {
      lines.push(`Table title: ${table.title}`);
    }

    lines.push(`Headers: ${table.headers.join(' | ')}`);

    const profileText = table.columnProfiles
      .map((profile) => `${profile.header}(${profile.inferredType})`)
      .join(' | ');

    lines.push(`Column types: ${profileText}`);

    for (const row of table.rows) {
      const fields = table.headers
        .map((header) => {
          const value = row[header];
          if (!value) return '';
          return `${header}: ${value}`;
        })
        .filter(Boolean);

      if (fields.length) {
        lines.push(`- ${fields.join('; ')}`);
      }
    }

    return lines.join('\n');
  }

  private inferCellType(value: string): ParsedDocumentCellType {
    const v = String(value || '').trim();

    if (!v) return 'empty';

    if (/^(true|false|是|否|yes|no)$/i.test(v)) {
      return 'boolean';
    }

    if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(v)) {
      return 'date';
    }

    if (/^-?\d+(\.\d+)?%?$/.test(v)) {
      return 'number';
    }

    const hasLetterOrChinese = /[a-zA-Z\u4e00-\u9fa5]/.test(v);
    const hasNumber = /\d/.test(v);

    if (hasLetterOrChinese && hasNumber) {
      return 'mixed';
    }

    return 'text';
  }

  private typeEntropy(values: string[]): number {
    if (!values.length) return 0;

    const counts = new Map<ParsedDocumentCellType, number>();

    for (const value of values) {
      const type = this.inferCellType(value);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    let entropy = 0;

    for (const count of counts.values()) {
      const p = count / values.length;
      entropy -= p * Math.log2(p);
    }

    return Math.min(1, entropy / 2);
  }

  private nextRowsTypeStability(rows: string[][]): number {
    if (!rows.length) return 0;

    const maxColumns = Math.max(...rows.map((row) => row.length), 1);
    let stableColumns = 0;
    let consideredColumns = 0;

    for (let col = 0; col < maxColumns; col += 1) {
      const values = rows
        .map((row) => this.normalizeCell(row[col] ?? ''))
        .filter(Boolean);

      if (values.length < 2) continue;

      consideredColumns += 1;

      const types = values.map((value) => this.inferCellType(value));
      const majority = this.majorityType(types);
      const majorityCount = types.filter((type) => type === majority).length;

      if (majorityCount / types.length >= 0.6) {
        stableColumns += 1;
      }
    }

    if (!consideredColumns) return 0;

    return stableColumns / consideredColumns;
  }

  private nextRowsDensity(rows: string[][]): number {
    if (!rows.length) return 0;

    const densities = rows.map((row) => {
      const nonEmpty = row.filter((cell) => this.normalizeCell(cell)).length;
      return nonEmpty / Math.max(row.length, 1);
    });

    return densities.reduce((sum, item) => sum + item, 0) / densities.length;
  }

  private currentVsNextTypeDifference(row: string[], nextRows: string[][]): number {
    if (!nextRows.length) return 0;

    const currentTypes = row.map((cell) => this.inferCellType(cell));
    const maxColumns = Math.max(row.length, ...nextRows.map((item) => item.length), 1);

    let different = 0;
    let comparable = 0;

    for (let col = 0; col < maxColumns; col += 1) {
      const currentType = currentTypes[col] ?? 'empty';

      const nextTypes = nextRows
        .map((nextRow) => this.inferCellType(this.normalizeCell(nextRow[col] ?? '')))
        .filter((type) => type !== 'empty');

      if (!nextTypes.length || currentType === 'empty') continue;

      comparable += 1;

      const majority = this.majorityType(nextTypes);

      if (currentType !== majority) {
        different += 1;
      }
    }

    if (!comparable) return 0;

    return different / comparable;
  }

  private majorityType(types: ParsedDocumentCellType[]): ParsedDocumentCellType {
    if (!types.length) return 'empty';

    const counts = new Map<ParsedDocumentCellType, number>();

    for (const type of types) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  }

  private normalizeCell(value: unknown): string {
    if (value === null || value === undefined) return '';

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return String(value)
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
