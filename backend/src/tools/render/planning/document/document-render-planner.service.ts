import { Injectable } from '@nestjs/common';
import type { ToolContext } from '../../../toolstypes';
import { RenderPlanningModelService } from '../core/render-planning-model.service';
import type { RenderPlanningRequest } from '../core/render-plan.types';
import { serializeForPrompt } from '../core/render-plan.util';
import { DOCUMENT_RENDER_PLAN_SCHEMA } from './document-render-plan.schema';
import { DOCUMENT_RENDER_PLAN_BLOCK_TYPES } from './document-render-plan.types';

@Injectable()
export class DocumentRenderPlannerService {
  constructor(private readonly model: RenderPlanningModelService) {}

  async plan(request: RenderPlanningRequest, context: ToolContext): Promise<string> {
    const systemPrompt = [
      'You are a general document render planner.',
      'Infer the best information structure, reading order, visual hierarchy, typography, spacing, tables, lists, pagination, header, and footer from the complete instruction and source.',
      'Do not classify the request using keyword rules and do not use a fixed document template.',
      'Use only the neutral renderer node types in the schema.',
      'Preserve supplied facts, names, numbers, relationships, and source language. Do not invent unsupported factual claims.',
      'Choose every visible design decision explicitly. Do not rely on renderer defaults: page, margins, fonts, sizes, alignment, spacing, indentation, colors, table behavior, headers, footers, and named styles must be intentional.',
      'When source.blocks contains stable ids, reference immutable content with sourceRef instead of copying or rewriting it. Never alter source-referenced content.',
      'Return exactly one JSON object. Do not return markdown fences, prose, XML, or implementation code.',
    ].join('\n');

    return this.model.generate({
      systemPrompt,
      userPrompt: serializeForPrompt({
        request,
        rendererCapability: {
          blocks: DOCUMENT_RENDER_PLAN_BLOCK_TYPES,
          outputFormats: ['docx', 'pdf'],
          styleControls: ['page', 'typography', 'paragraph', 'colors', 'table', 'namedStyles', 'header', 'footer'],
          contentReferences: true,
        },
        schema: DOCUMENT_RENDER_PLAN_SCHEMA,
      }),
      context,
      temperature: 0.25,
    });
  }
}
