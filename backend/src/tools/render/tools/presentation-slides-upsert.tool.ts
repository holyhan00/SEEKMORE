import { BadRequestException, Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../toolstypes';
import { PresentationAuthoringService } from '../presentation/presentation-authoring.service';
import {
  canAuthorPresentation,
  PRESENTATION_FILL_SCHEMA,
  PRESENTATION_SCENE_SCHEMA,
  PRESENTATION_SLIDE_DESIGN_INTENT_SCHEMA,
} from './presentation-tool.schema';

const INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['presentationId', 'slides'],
  properties: {
    presentationId: { type: 'string', minLength: 1 },
    slides: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'scene'],
        properties: {
          id: { type: 'string', minLength: 1 },
          designIntent: PRESENTATION_SLIDE_DESIGN_INTENT_SCHEMA,
          background: PRESENTATION_FILL_SCHEMA,
          scene: PRESENTATION_SCENE_SCHEMA,
        },
      },
    },
  },
} as const;

@Injectable()
export class PresentationSlidesUpsertRuntimeTool implements Tool {
  name = 'presentation.slides.upsert';
  description = 'Store or replace authored presentation slides. Author each scene against the stored designStudy, designDNA, and slide designIntent: establish one clear focal point, strong hierarchy and whitespace, use visuals purposefully, avoid default card grids for non-peer content, and maintain intentional deck rhythm across adjacent slides. The design grammar is a starting point rather than a fixed template. Semantic scenes express size and spatial relationships; advanced scenes accept exact editable geometry.';
  tags = ['presentation', 'authoring', 'slide', 'scene'];
  timeoutMs = 120_000;
  parallelism: NonNullable<Tool['parallelism']> = 'resource_serial';
  conflictKeyFields = ['presentationId'];
  inputSchema = INPUT_SCHEMA;

  constructor(private readonly authoring: PresentationAuthoringService) {}

  validateArgs(args: Dict): void {
    if (!String(args.presentationId ?? '').trim()) {
      throw new BadRequestException({ code: 'PRESENTATION_ID_REQUIRED', message: 'presentationId is required.' });
    }
    if (!Array.isArray(args.slides) || args.slides.length === 0) {
      throw new BadRequestException({ code: 'PRESENTATION_SLIDES_REQUIRED', message: 'slides must contain at least one slide.' });
    }
  }

  canExecute(ctx: ToolContext): boolean {
    return canAuthorPresentation(ctx);
  }

  execute(args: Dict, ctx: ToolContext) {
    return this.authoring.upsertSlides(String(args.presentationId ?? ''), args.slides as never, ctx);
  }
}
