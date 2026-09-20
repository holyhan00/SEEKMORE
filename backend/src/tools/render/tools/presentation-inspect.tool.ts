import { BadRequestException, Injectable } from '@nestjs/common';
import type { Dict, Tool, ToolContext } from '../../toolstypes';
import { PresentationAuthoringService } from '../presentation/presentation-authoring.service';
import { canAuthorPresentation } from './presentation-tool.schema';

const INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['presentationId'],
  properties: {
    presentationId: { type: 'string', minLength: 1 },
    includeSource: { type: 'boolean' },
    slideIds: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string', minLength: 1 },
    },
  },
} as const;

@Injectable()
export class PresentationInspectRuntimeTool implements Tool {
  name = 'presentation.inspect';
  description = 'Resolve authored slides, return objective layout diagnostics, and create PNG observations of the canonical resolved scene for selected slides. Use the observations when visual review is useful: check focal point, hierarchy, whitespace, balance, image crop, text density, consistency with the stored design intent, and rhythm relative to nearby slides before deciding whether revision is needed.';
  tags = ['presentation', 'inspect', 'diagnostics', 'image'];
  timeoutMs = 90_000;
  parallelism: NonNullable<Tool['parallelism']> = 'resource_serial';
  conflictKeyFields = ['presentationId'];
  inputSchema = INPUT_SCHEMA;

  constructor(private readonly authoring: PresentationAuthoringService) {}

  validateArgs(args: Dict): void {
    if (!String(args.presentationId ?? '').trim()) {
      throw new BadRequestException({ code: 'PRESENTATION_ID_REQUIRED', message: 'presentationId is required.' });
    }
  }

  canExecute(ctx: ToolContext): boolean {
    return canAuthorPresentation(ctx);
  }

  execute(args: Dict, ctx: ToolContext) {
    const slideIds = Array.isArray(args.slideIds)
      ? args.slideIds.map((value) => String(value ?? '').trim()).filter(Boolean)
      : undefined;
    return this.authoring.inspect(String(args.presentationId ?? ''), slideIds, args.includeSource === true, ctx);
  }
}
