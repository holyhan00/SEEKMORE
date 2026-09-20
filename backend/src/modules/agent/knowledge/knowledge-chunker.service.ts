                                                                   

import { Injectable } from '@nestjs/common';
import type {
  ParsedDocument,
  ParsedDocumentTable,
} from '../../document-parser/document.types';
import type {
  KnowledgeChunk,
  KnowledgeChunkKind,
} from './knowledge.types';

type ChunkOptions = {
  chunkSize?: number;
  overlap?: number;
};

type ResolvedChunkOptions = {
  chunkSize: number;
  overlap: number;
};

@Injectable()
export class KnowledgeChunkerService {
  private readonly defaultChunkSize = 1200;
  private readonly defaultOverlap = 160;
  private readonly minChunkSize = 400;
  private readonly maxChunkSize = 2400;

  chunkParsedDocument(
    parsed: ParsedDocument,
    options?: ChunkOptions,
  ): KnowledgeChunk[] {
    const resolved = this.resolveOptions(options);
    const chunks: KnowledgeChunk[] = [];

    if (parsed.tables?.length) {
      for (const table of parsed.tables) {
        chunks.push(
          ...this.chunkTable(
            table,
            parsed.kind,
            resolved,
          ),
        );
      }
    }

    if (parsed.sections?.length) {
      for (const section of parsed.sections) {
        const title = this.normalizeText(section.title ?? '');
        const body = this.normalizeText(section.content);
        if (!title && !body) continue;

        const prefix = title ? `# ${title}` : '';
        const bodyBudget = Math.max(
          this.minChunkSize,
          resolved.chunkSize - prefix.length - (prefix ? 2 : 0),
        );
        const bodyParts = body
          ? this.splitText(body, {
              chunkSize: bodyBudget,
              overlap: Math.min(resolved.overlap, Math.floor(bodyBudget / 3)),
            })
          : [''];

        const segmentCount = Math.max(bodyParts.length, 1);
        bodyParts.forEach((part, segmentIndex) => {
          const content = this.normalizeText(
            [prefix, part].filter(Boolean).join('\n\n'),
          );
          if (!content) return;

          chunks.push(
            this.createChunk(
              content,
              'section',
              {
                sourceKind: parsed.kind,
                chunkKind: 'section',
                title: section.title,
                level: section.level,
                segmentIndex,
                segmentCount,
                ...(section.meta ?? {}),
              },
            ),
          );
        });
      }
    }

    if (!chunks.length && parsed.text) {
      const textParts = this.splitText(parsed.text, resolved);
      textParts.forEach((content, segmentIndex) => {
        chunks.push(
          this.createChunk(
            content,
            'text',
            {
              sourceKind: parsed.kind,
              chunkKind: 'text',
              segmentIndex,
              segmentCount: textParts.length,
            },
          ),
        );
      });
    }

    return chunks.map((chunk, chunkIndex) => ({
      ...chunk,
      chunkIndex,
    }));
  }

  chunkText(
    text: string,
    options?: ChunkOptions,
  ): KnowledgeChunk[] {
    const resolved = this.resolveOptions(options);
    const parts = this.splitText(text, resolved);

    return parts.map((content, chunkIndex) =>
      this.createChunk(
        content,
        'text',
        {
          sourceKind: 'text',
          chunkKind: 'text',
          segmentIndex: chunkIndex,
          segmentCount: parts.length,
        },
        chunkIndex,
      ),
    );
  }

  private chunkTable(
    table: ParsedDocumentTable,
    sourceKind: string,
    options: ResolvedChunkOptions,
  ): KnowledgeChunk[] {
    const prefixLines = ['# Table'];
    if (table.sheetName) prefixLines.push(`Sheet: ${table.sheetName}`);
    if (table.title) prefixLines.push(`Title: ${table.title}`);
    if (table.headers.length) {
      prefixLines.push(`Headers: ${table.headers.join(' | ')}`);
    }

    if (table.columnProfiles?.length) {
      prefixLines.push(
        `Column types: ${table.columnProfiles
          .map((item) => `${item.header}(${item.inferredType})`)
          .join(' | ')}`,
      );
    }

    const prefix = this.normalizeText(prefixLines.join('\n'));
    const rowLines = table.rows
      .map((row) => this.renderTableRow(table, row))
      .filter(Boolean);

    if (!rowLines.length) {
      if (!prefix) return [];
      return [
        this.createChunk(prefix, 'table', {
          sourceKind,
          chunkKind: 'table',
          sheetName: table.sheetName,
          tableTitle: table.title,
          headerRowIndex: table.headerRowIndex,
          headers: table.headers,
          columnProfiles: table.columnProfiles,
          rowCount: table.rows.length,
          rowStart: null,
          rowEnd: null,
          ...(table.meta ?? {}),
        }),
      ];
    }

    const chunks: KnowledgeChunk[] = [];
    const maxBodySize = Math.max(
      this.minChunkSize,
      options.chunkSize - prefix.length - (prefix ? 2 : 0),
    );

    let currentRows: string[] = [];
    let currentSize = 0;
    let rowStart = 0;

    const flush = (rowEnd: number) => {
      if (!currentRows.length) return;
      const content = this.normalizeText(
        [prefix, currentRows.join('\n')].filter(Boolean).join('\n\n'),
      );
      chunks.push(
        this.createChunk(content, 'table', {
          sourceKind,
          chunkKind: 'table',
          sheetName: table.sheetName,
          tableTitle: table.title,
          headerRowIndex: table.headerRowIndex,
          headers: table.headers,
          columnProfiles: table.columnProfiles,
          rowCount: table.rows.length,
          rowStart,
          rowEnd,
          ...(table.meta ?? {}),
        }),
      );
      currentRows = [];
      currentSize = 0;
    };

    rowLines.forEach((line, rowIndex) => {
      if (line.length > maxBodySize) {
        flush(rowIndex - 1);
        const parts = this.splitText(line, {
          chunkSize: maxBodySize,
          overlap: Math.min(options.overlap, Math.floor(maxBodySize / 3)),
        });
        parts.forEach((part, segmentIndex) => {
          const content = this.normalizeText(
            [prefix, part].filter(Boolean).join('\n\n'),
          );
          chunks.push(
            this.createChunk(content, 'table_row', {
              sourceKind,
              chunkKind: 'table_row',
              sheetName: table.sheetName,
              tableTitle: table.title,
              headerRowIndex: table.headerRowIndex,
              headers: table.headers,
              columnProfiles: table.columnProfiles,
              rowCount: table.rows.length,
              rowStart: rowIndex,
              rowEnd: rowIndex,
              segmentIndex,
              segmentCount: parts.length,
              ...(table.meta ?? {}),
            }),
          );
        });
        rowStart = rowIndex + 1;
        return;
      }

      const addedSize = line.length + (currentRows.length ? 1 : 0);
      if (currentRows.length && currentSize + addedSize > maxBodySize) {
        flush(rowIndex - 1);
        rowStart = rowIndex;
      }

      currentRows.push(line);
      currentSize += addedSize;
    });

    flush(rowLines.length - 1);

    return chunks;
  }

  private renderTableRow(
    table: ParsedDocumentTable,
    row: Record<string, string>,
  ): string {
    const fields = table.headers
      .map((header) => {
        const value = String(row[header] ?? '').trim();
        return value ? `${header}: ${value}` : '';
      })
      .filter(Boolean);

    return fields.length ? `- ${fields.join('；')}` : '';
  }

  private splitText(
    text: string,
    options: ResolvedChunkOptions,
  ): string[] {
    const normalized = this.normalizeText(text);
    if (!normalized) return [];
    if (normalized.length <= options.chunkSize) return [normalized];

    const parts: string[] = [];
    let start = 0;

    while (start < normalized.length) {
      const hardEnd = Math.min(start + options.chunkSize, normalized.length);
      let end = hardEnd;

      if (hardEnd < normalized.length) {
        end = this.findNaturalBoundary(normalized, start, hardEnd);
      }

      if (end <= start) {
        end = hardEnd;
      }

      const content = normalized.slice(start, end).trim();
      if (content) parts.push(content);

      if (end >= normalized.length) break;

      const nextStart = Math.max(0, end - options.overlap);
      start = nextStart > start ? nextStart : end;
    }

    return parts;
  }

  private findNaturalBoundary(
    text: string,
    start: number,
    hardEnd: number,
  ): number {
    const searchStart = Math.max(
      start + Math.floor((hardEnd - start) * 0.6),
      start + 1,
    );
    const window = text.slice(searchStart, hardEnd);
    const boundaries = ['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', '；', '; ', ' '];

    let best = -1;
    let boundaryLength = 0;

    for (const boundary of boundaries) {
      const index = window.lastIndexOf(boundary);
      if (index > best) {
        best = index;
        boundaryLength = boundary.length;
      }
    }

    return best >= 0
      ? searchStart + best + boundaryLength
      : hardEnd;
  }

  private createChunk(
    content: string,
    kind: KnowledgeChunkKind,
    meta: Record<string, unknown>,
    chunkIndex = 0,
  ): KnowledgeChunk {
    return {
      chunkIndex,
      content,
      tokenCount: this.estimateTokens(content),
      kind,
      meta,
    };
  }

  private resolveOptions(options?: ChunkOptions): ResolvedChunkOptions {
    const requestedSize = Number(options?.chunkSize ?? this.defaultChunkSize);
    const chunkSize = Math.max(
      this.minChunkSize,
      Math.min(this.maxChunkSize, Number.isFinite(requestedSize) ? requestedSize : this.defaultChunkSize),
    );

    const requestedOverlap = Number(options?.overlap ?? this.defaultOverlap);
    const overlap = Math.max(
      0,
      Math.min(
        Math.floor(chunkSize / 3),
        Number.isFinite(requestedOverlap) ? requestedOverlap : this.defaultOverlap,
      ),
    );

    return { chunkSize, overlap };
  }

  private normalizeText(text: string): string {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 2);
  }
}
