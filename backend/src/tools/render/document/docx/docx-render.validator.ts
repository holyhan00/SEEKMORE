                                                                  

import { BadRequestException, Injectable } from '@nestjs/common';
import {
  isRenderPlaceholderText,
} from '../../planning/core/render-plan.util';
import {
  DocxBlock,
  DocxRenderPayload,
  DocxTableSpec,
} from './docx-render.types';

@Injectable()
export class DocxRenderValidator {
  private readonly maxTextLength = 1_000_000;

  private readonly maxBlocks = 2000;

  private readonly maxRowsPerTable = 10000;

  private readonly maxColumnsPerTable = 100;

  validate(payload: DocxRenderPayload): void {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException({ code: 'DOCX_PAYLOAD_OBJECT_REQUIRED', message: 'DOCX payload must be an object' });
    }

    const hasContent = Boolean(
      payload.title ||
        payload.subtitle ||
        payload.content ||
        payload.markdown ||
        payload.blocks?.length ||
        payload.tables?.length,
    );

    if (!hasContent) {
      throw new BadRequestException({ code: 'DOCX_PAYLOAD_EMPTY', message: 'DOCX payload is empty' });
    }

    const textSize = JSON.stringify({
      title: payload.title,
      subtitle: payload.subtitle,
      content: payload.content,
      markdown: payload.markdown,
    }).length;

    if (textSize > this.maxTextLength) {
      throw new BadRequestException({
        code: 'DOCX_TEXT_LIMIT_EXCEEDED',
        message: `DOCX text exceeds limit ${this.maxTextLength}`,
        params: { limit: this.maxTextLength },
      });
    }

    if ((payload.blocks?.length ?? 0) > this.maxBlocks) {
      throw new BadRequestException({
        code: 'DOCX_BLOCK_LIMIT_EXCEEDED',
        message: `DOCX blocks exceed limit ${this.maxBlocks}`,
        params: { limit: this.maxBlocks },
      });
    }

    for (const block of payload.blocks ?? []) {
      this.validateBlock(block);
    }

    for (const table of payload.tables ?? []) {
      this.validateTable(table);
    }
  }

  private validateBlock(block: DocxBlock) {
    if (!block.type) {
      throw new BadRequestException({ code: 'DOCX_BLOCK_TYPE_REQUIRED', message: 'DOCX block.type is required' });
    }

    if (block.type === 'table') {
      this.validateTable(block.table);
    }

    if (
      (
        block.type === 'heading'
        || block.type === 'paragraph'
        || block.type === 'quote'
      )
      && isRenderPlaceholderText(block.text)
    ) {
      throw new BadRequestException({
        code: 'DOCX_SOURCE_PLACEHOLDER_NOT_ALLOWED',
        message: 'DOCX content must contain real final text, not a block placeholder.',
      });
    }

    if (
      block.type === 'paragraph'
      && block.runs?.some((run) =>
        isRenderPlaceholderText(run.text),
      )
    ) {
      throw new BadRequestException({
        code: 'DOCX_SOURCE_PLACEHOLDER_NOT_ALLOWED',
        message: 'DOCX content must contain real final text, not a block placeholder.',
      });
    }

    if (
      block.type === 'list'
      && block.items.some((item) =>
        isRenderPlaceholderText(item),
      )
    ) {
      throw new BadRequestException({
        code: 'DOCX_SOURCE_PLACEHOLDER_NOT_ALLOWED',
        message: 'DOCX content must contain real final text, not a block placeholder.',
      });
    }

    if (block.type === 'image') {
      if (!block.image?.dataBase64) {
        throw new BadRequestException({ code: 'DOCX_IMAGE_BASE64_REQUIRED', message: 'DOCX image block missing base64' });
      }
    }
  }

  private validateTable(table: DocxTableSpec) {
    if (!Array.isArray(table.rows)) {
      throw new BadRequestException({ code: 'DOCX_TABLE_ROWS_ARRAY_REQUIRED', message: 'DOCX table rows must be an array' });
    }

    if (table.rows.length > this.maxRowsPerTable) {
      throw new BadRequestException({
        code: 'DOCX_TABLE_ROW_LIMIT_EXCEEDED',
        message: `DOCX table rows exceed limit ${this.maxRowsPerTable}`,
        params: { limit: this.maxRowsPerTable },
      });
    }

    const colCount =
      table.columns?.length ||
      table.headers?.length ||
      (Array.isArray(table.rows[0])
        ? table.rows[0].length
        : Object.keys(table.rows[0] || {}).length);

    if (colCount > this.maxColumnsPerTable) {
      throw new BadRequestException({
        code: 'DOCX_TABLE_COLUMN_LIMIT_EXCEEDED',
        message: `DOCX table columns exceed limit ${this.maxColumnsPerTable}`,
        params: { limit: this.maxColumnsPerTable },
      });
    }
  }
}