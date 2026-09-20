import { ToolError } from '../../../toolstypes';
import type { RenderPlanDiagnostic, RenderPlanStage } from './render-plan-diagnostics.types';

export class RenderPlanningError extends ToolError {
  constructor(
    code: string,
    message: string,
    public readonly stage: RenderPlanStage,
    public readonly diagnostics: RenderPlanDiagnostic[] = [],
    public readonly retryable = false,
  ) {
    super(code, message, {
      stage,
      diagnostics,
      retryable,
    });
    this.name = 'RenderPlanningError';
  }
}
