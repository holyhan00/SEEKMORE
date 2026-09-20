import { BadRequestException, Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../toolstypes';
import { PresentationAuthoringService } from '../presentation/presentation-authoring.service';
import {
  canAuthorPresentation,
  PRESENTATION_DESIGN_DNA_SCHEMA,
  PRESENTATION_DESIGN_STUDY_SCHEMA,
  PRESENTATION_SLIDE_DESIGN_INTENT_SCHEMA,
} from './presentation-tool.schema';

const INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'purpose', 'outline', 'designStudy', 'designDNA', 'page'],
  properties: {
    title: { type: 'string', minLength: 1 },
    purpose: { type: 'string', minLength: 1 },
    audience: { type: 'string' },
    usage: { type: 'string' },
    language: { type: 'string' },
    storyline: { type: 'string' },
    outline: {
      type: 'array',
      minItems: 1,
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'purpose'],
        properties: {
          id: { type: 'string', minLength: 1 },
          title: { type: 'string' },
          purpose: { type: 'string', minLength: 1 },
          keyMessage: { type: 'string' },
          designIntent: PRESENTATION_SLIDE_DESIGN_INTENT_SCHEMA,
        },
      },
    },
    designStudy: PRESENTATION_DESIGN_STUDY_SCHEMA,
    designDNA: PRESENTATION_DESIGN_DNA_SCHEMA,
    page: {
      type: 'object',
      additionalProperties: false,
      required: ['widthInch', 'heightInch'],
      properties: {
        widthInch: { type: 'number', minimum: 0.1, maximum: 30 },
        heightInch: { type: 'number', minimum: 0.1, maximum: 30 },
      },
    },
    filename: { type: 'string' },
  },
} as const;

@Injectable()
export class PresentationCreateRuntimeTool implements Tool {
  name = 'presentation.create';
  description = 'Create a persistent presentation workspace and plan the deck before authoring slides. Keep designStudy concise and actionable across composition, hierarchy, typography, whitespace, imagery, data visualization, deck rhythm, constraints, and avoid items. Use designDNA for deck-wide visual language, and use outline designIntent to choose a strong preferred structure, density, and visual weight for each slide without fixing exact geometry.';
  tags = ['presentation', 'authoring', 'outline', 'object'];
  timeoutMs = 15_000;
  parallelism: NonNullable<Tool['parallelism']> = 'parallel_safe';
  inputSchema = INPUT_SCHEMA;

  constructor(private readonly authoring: PresentationAuthoringService) {}

  validateArgs(args: Dict): void {
    if (!String(args.title ?? '').trim() || !String(args.purpose ?? '').trim()) {
      throw new BadRequestException({ code: 'PRESENTATION_CREATE_INPUT_INVALID', message: 'presentation.create requires title and purpose.' });
    }
    if (!Array.isArray(args.outline) || args.outline.length === 0) {
      throw new BadRequestException({ code: 'PRESENTATION_OUTLINE_REQUIRED', message: 'presentation.create requires a non-empty outline.' });
    }
    if (!args.designStudy || typeof args.designStudy !== 'object' || Array.isArray(args.designStudy)) {
      throw new BadRequestException({ code: 'PRESENTATION_DESIGN_STUDY_REQUIRED', message: 'presentation.create requires designStudy.' });
    }
    if (!args.designDNA || typeof args.designDNA !== 'object' || Array.isArray(args.designDNA)) {
      throw new BadRequestException({ code: 'PRESENTATION_DESIGN_DNA_REQUIRED', message: 'presentation.create requires designDNA.' });
    }
    if (!args.page || typeof args.page !== 'object' || Array.isArray(args.page)) {
      throw new BadRequestException({ code: 'PRESENTATION_PAGE_REQUIRED', message: 'presentation.create requires page width and height.' });
    }
  }

  canExecute(ctx: ToolContext): boolean {
    return canAuthorPresentation(ctx);
  }

  execute(args: Dict, ctx: ToolContext) {
    return this.authoring.create(args as never, ctx);
  }
}
