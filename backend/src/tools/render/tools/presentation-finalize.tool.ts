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
    filename: { type: 'string' },
  },
} as const;

@Injectable()
export class PresentationFinalizeRuntimeTool implements Tool {
  name = 'presentation.finalize';
  description = 'Validate a complete presentation workspace, serialize an editable PPTX, verify its package and media relationships, and persist the output object.';
  tags = ['presentation', 'finalize', 'pptx', 'object'];
  timeoutMs = 180_000;
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
    return this.authoring.finalize(
      String(args.presentationId ?? ''),
      typeof args.filename === 'string' ? args.filename : undefined,
      ctx,
    );
  }
}
