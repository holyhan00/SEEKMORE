import type { ToolContext } from '../../../toolstypes';
import type { RenderArtifact, RenderPayload, RenderToolName } from '../../render.types';
import type { RenderStageResult } from './render-plan-diagnostics.types';
import type { RenderPlanBase, RenderPlanFormat, RenderPlanKind, RenderPlanningRequest } from './render-plan.types';

export interface RenderOutputVerificationInput<TPlan extends RenderPlanBase> {
  plan: TPlan;
  artifact: RenderArtifact;
  request: RenderPlanningRequest;
}

export interface RenderPlanningCapability<
  TPlan extends RenderPlanBase = RenderPlanBase,
  TPayload extends RenderPayload = RenderPayload,
> {
  readonly kind: RenderPlanKind;
  readonly formats: readonly RenderPlanFormat[];
  readonly schema: Record<string, unknown>;

  plan(request: RenderPlanningRequest, context: ToolContext): Promise<unknown>;
  normalize?(plan: unknown): RenderStageResult<unknown>;
  validate(plan: unknown): RenderStageResult<TPlan>;
  validateExecution?(plan: TPlan, request: RenderPlanningRequest): RenderStageResult<TPlan>;
  compile(plan: TPlan, request: RenderPlanningRequest): RenderStageResult<{
    toolName: RenderToolName;
    payload: TPayload;
    filename: string;
  }>;
  verifyOutput(
    input: RenderOutputVerificationInput<TPlan>,
  ): Promise<RenderStageResult<RenderArtifact>>;
}
