import { ToolError } from '../../toolstypes';
import type {
  RenderPlanDiagnostic,
  RenderPlanStage,
} from '../planning/core/render-plan-diagnostics.types';

export class PresentationRenderError extends ToolError {
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
    this.name = 'PresentationRenderError';
  }
}
