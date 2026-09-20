                                                               
import { Injectable } from '@nestjs/common';
import {
  DocxBlock,
  DocxRenderPayload,
  DocxTableCellSpec,
  DocxTableSpec,
  NormalizedDocxTable,
  NormalizedDocxTableCell,
} from './docx-render.types';

@Injectable()
export class DocxRenderMapper {
  normalize(
    payload: DocxRenderPayload,
  ): Required<Pick<DocxRenderPayload, 'theme'>> & {
    title?: string;
    subtitle?: string;
    blocks: DocxBlock[];
  } {
    const blocks: DocxBlock[] = [];

    if (payload.blocks?.length) {
      blocks.push(...payload.blocks);
    }

    if (!blocks.length && payload.markdown) {
      blocks.push(...this.markdownToBlocks(payload.markdown));
    }

    if (!blocks.length && payload.content) {
      blocks.push(...this.plainTextToBlocks(payload.content));
    }

    if (payload.tables?.length) {
      for (const table of payload.tables) {
        blocks.push({
          type: 'table',
          table,
        });
      }
    }

    return {
      title: payload.title,
      subtitle: payload.subtitle,
      theme: payload.theme ?? {},
      blocks,
    };
  }

  normalizeTable(table: DocxTableSpec): NormalizedDocxTable {
    if (table.columns?.length) {
      const headers = table.columns.map((column) => {
        const style = column.headerStyle ?? column.style;

        return {
          text: column.header || column.key,
          align: this.normalizeTableCellAlign(column.align),
          width: column.width,
          bold: true,
          style,
          ...(style && typeof style === 'object' ? style : {}),
        };
      });

      const rows = table.rows.map((row) => {
        if (Array.isArray(row)) {
          return row.map((cell) => this.normalizeCell(cell));
        }

        return table.columns!.map((column) =>
          this.normalizeCell(row[column.key]),
        );
      });

      return {
        title: table.title,
        caption: table.caption,
        striped: table.striped,
        compact: table.compact,
        border: table.border,
        style: table.style,
        headers,
        rows,
      };
    }

    const headers = (table.headers ?? []).map((cell) =>
      this.normalizeCell(cell, true),
    );

    const rows = table.rows.map((row) => {
      if (Array.isArray(row)) {
        return row.map((cell) => this.normalizeCell(cell));
      }

      const keys = headers.length ? headers.map((h) => h.text) : Object.keys(row);

      return keys.map((key) => this.normalizeCell(row[key]));
    });

    return {
      title: table.title,
      caption: table.caption,
      striped: table.striped,
      compact: table.compact,
      border: table.border,
      style: table.style,
      headers,
      rows,
    };
  }

  private normalizeCell(
    value: unknown,
    header = false,
  ): NormalizedDocxTableCell {
    if (
      value &&
      typeof value === 'object' &&
      ('text' in (value as Record<string, unknown>) ||
        'value' in (value as Record<string, unknown>))
    ) {
      const cell = value as DocxTableCellSpec;

      return {
        text: this.valueToText(cell.text ?? cell.value),
        bold: cell.bold ?? header,
        italics: cell.italics,
        colSpan: cell.colSpan,
        rowSpan: cell.rowSpan,
        width: cell.width,
        align: this.normalizeTableCellAlign(cell.align),
        verticalAlign: cell.verticalAlign,
        shading: cell.shading,
        color: cell.color,
        border: cell.border,
        style: cell.style,
        ...(cell.style && typeof cell.style === 'object' ? cell.style : {}),
      };
    }

    return {
      text: this.valueToText(value),
      bold: header,
    };
  }

  private markdownToBlocks(markdown: string): DocxBlock[] {
    const blocks: DocxBlock[] = [];
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');

    let paragraph: string[] = [];
    let listItems: string[] = [];

    const flushParagraph = () => {
      const text = paragraph.join(' ').trim();

      if (text) {
        blocks.push({
          type: 'paragraph',
          text,
        });
      }

      paragraph = [];
    };

    const flushList = () => {
      if (listItems.length) {
        blocks.push({
          type: 'list',
          items: [...listItems],
        });
      }

      listItems = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        flushParagraph();
        flushList();
        continue;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(line);

      if (heading) {
        flushParagraph();
        flushList();

        blocks.push({
          type: 'heading',
          level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
          text: heading[2],
        });

        continue;
      }

      const bullet = /^[-*+]\s+(.+)$/.exec(line);

      if (bullet) {
        flushParagraph();
        listItems.push(bullet[1]);
        continue;
      }

      if (/^---+$/.test(line)) {
        flushParagraph();
        flushList();

        blocks.push({
          type: 'line',
        });

        continue;
      }

      if (/^===+$/.test(line)) {
        flushParagraph();
        flushList();

        blocks.push({
          type: 'pageBreak',
        });

        continue;
      }

      if (line.startsWith('>')) {
        flushParagraph();
        flushList();

        blocks.push({
          type: 'quote',
          text: line.replace(/^>\s?/, ''),
        });

        continue;
      }

      paragraph.push(line);
    }

    flushParagraph();
    flushList();

    return blocks;
  }

  private plainTextToBlocks(text: string): DocxBlock[] {
    return text
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/g)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => ({
        type: 'paragraph',
        text: part,
      }));
  }

  private normalizeTableCellAlign(
    value: unknown,
  ): 'left' | 'center' | 'right' | undefined {
    if (value === 'left') return 'left';
    if (value === 'center') return 'center';
    if (value === 'right') return 'right';
    return undefined;
  }

  private valueToText(value: unknown): string {
    if (value == null) return '';

    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }
}