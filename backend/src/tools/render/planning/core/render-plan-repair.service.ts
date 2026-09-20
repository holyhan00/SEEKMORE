import { Injectable } from '@nestjs/common';
import type { ToolContext } from '../../../toolstypes';
import type { RenderPlanDiagnostic } from './render-plan-diagnostics.types';
import { RenderPlanningModelService } from './render-planning-model.service';
import { serializeForPrompt } from './render-plan.util';

@Injectable()
export class RenderPlanRepairService {
  constructor(private readonly model: RenderPlanningModelService) {}

  async repair(input: {
    previous: unknown;
    diagnostics: RenderPlanDiagnostic[];
    schema: Record<string, unknown>;
    context: ToolContext;
  }): Promise<string> {
    const systemPrompt = [
      'You repair a render plan JSON object.',
      'Preserve all valid content, facts, data, ordering decisions, and design decisions unless a diagnostic explicitly requires a change.',
      'Change only what is required to resolve the diagnostics.',
      'Do not add commentary, markdown fences, or implementation code.',
      'Return one complete JSON object that conforms to the supplied schema.',
    ].join('\n');

    const userPrompt = serializeForPrompt({
      previous: input.previous,
      diagnostics: input.diagnostics,
      schema: input.schema,
    });

    return this.model.generate({
      systemPrompt,
      userPrompt,
      context: input.context,
      temperature: 0.1,
    });
  }
}
