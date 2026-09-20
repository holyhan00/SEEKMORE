import { Injectable } from '@nestjs/common';
import { failure, success, type RenderPlanDiagnostic, type RenderStageResult } from '../core/render-plan-diagnostics.types';
import { isRecord, nonEmptyString, stringArray } from '../core/render-plan.util';
import { DOCUMENT_RENDER_PLAN_BLOCK_TYPES, type DocumentRenderPlan } from './document-render-plan.types';

@Injectable()
export class DocumentRenderPlanValidator {
  validate(input: unknown): RenderStageResult<DocumentRenderPlan> {
    const diagnostics: RenderPlanDiagnostic[] = [];
    if (!isRecord(input)) return failure([this.error('DOCUMENT_PLAN_ROOT_INVALID', 'Document render plan must be an object.', '$')]);

    if (input.version !== 'render-plan/v1') diagnostics.push(this.error('DOCUMENT_PLAN_VERSION_INVALID', 'version must be render-plan/v1.', '$.version'));
    if (input.kind !== 'document') diagnostics.push(this.error('DOCUMENT_PLAN_KIND_INVALID', 'kind must be document.', '$.kind'));

    const objective = isRecord(input.objective) ? input.objective : {};
    if (!nonEmptyString(objective.purpose)) diagnostics.push(this.error('DOCUMENT_PLAN_PURPOSE_REQUIRED', 'objective.purpose is required.', '$.objective.purpose'));

    const composition = isRecord(input.composition) ? input.composition : {};
    if (!nonEmptyString(composition.title)) diagnostics.push(this.error('DOCUMENT_PLAN_TITLE_REQUIRED', 'composition.title is required.', '$.composition.title'));
    if (!Array.isArray(composition.blocks) || composition.blocks.length === 0) {
      diagnostics.push(this.error('DOCUMENT_PLAN_BLOCKS_REQUIRED', 'composition.blocks must contain at least one block.', '$.composition.blocks'));
    } else if (composition.blocks.length > 2000) {
      diagnostics.push(this.error('DOCUMENT_PLAN_BLOCK_LIMIT', 'composition.blocks exceeds the maximum of 2000.', '$.composition.blocks', false));
    } else {
      composition.blocks.forEach((block, index) => diagnostics.push(...this.validateBlock(block, index)));
    }

    const output = isRecord(input.output) ? input.output : {};
    if (!['docx', 'pdf'].includes(String(output.format ?? ''))) diagnostics.push(this.error('DOCUMENT_PLAN_FORMAT_INVALID', 'output.format must be docx or pdf.', '$.output.format'));
    if (!nonEmptyString(output.filename)) diagnostics.push(this.error('DOCUMENT_PLAN_FILENAME_REQUIRED', 'output.filename is required.', '$.output.filename'));

    if (diagnostics.some((item) => item.severity === 'error')) return failure(diagnostics);
    return success(input as unknown as DocumentRenderPlan, diagnostics);
  }

  private validateBlock(input: unknown, index: number): RenderPlanDiagnostic[] {
    const path = `$.composition.blocks[${index}]`;
    if (!isRecord(input)) return [this.error('DOCUMENT_PLAN_BLOCK_INVALID', 'Block must be an object.', path)];
    const type = nonEmptyString(input.type);
    if (!type || !(DOCUMENT_RENDER_PLAN_BLOCK_TYPES as readonly string[]).includes(type)) return [this.error('DOCUMENT_PLAN_BLOCK_TYPE_INVALID', 'Block type is not supported.', `${path}.type`)];

    const diagnostics: RenderPlanDiagnostic[] = [];
    const textTypes = new Set(['heading', 'paragraph', 'quote']);
    if (textTypes.has(type) && !nonEmptyString(input.text)) diagnostics.push(this.error('DOCUMENT_PLAN_BLOCK_TEXT_REQUIRED', `${type} block requires text.`, `${path}.text`));
    if (type === 'heading') {
      const level = Number(input.level);
      if (!Number.isInteger(level) || level < 1 || level > 6) diagnostics.push(this.error('DOCUMENT_PLAN_HEADING_LEVEL_INVALID', 'heading.level must be an integer from 1 to 6.', `${path}.level`));
    }
    if (type === 'list' && stringArray(input.items).length === 0) diagnostics.push(this.error('DOCUMENT_PLAN_LIST_ITEMS_REQUIRED', 'list.items must contain text items.', `${path}.items`));
    if (type === 'table') {
      if (!Array.isArray(input.rows)) diagnostics.push(this.error('DOCUMENT_PLAN_TABLE_ROWS_REQUIRED', 'table.rows must be an array.', `${path}.rows`));
      if (Array.isArray(input.rows) && input.rows.length > 10000) diagnostics.push(this.error('DOCUMENT_PLAN_TABLE_ROW_LIMIT', 'table.rows exceeds the maximum of 10000.', `${path}.rows`, false));
    }
    if (type === 'image' && !nonEmptyString(input.dataBase64)) diagnostics.push(this.error('DOCUMENT_PLAN_IMAGE_DATA_REQUIRED', 'image.dataBase64 is required for an executable image block.', `${path}.dataBase64`));
    return diagnostics;
  }

  private error(code: string, message: string, path: string, repairable = true): RenderPlanDiagnostic {
    return { stage: 'validation', code, message, path, severity: 'error', repairable };
  }
}
