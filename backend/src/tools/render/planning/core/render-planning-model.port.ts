import type { ToolContext } from '../../../toolstypes';

export const RENDER_PLANNING_MODEL_PORT = Symbol('RENDER_PLANNING_MODEL_PORT');

export interface RenderPlanningModelRequest {
  systemPrompt: string;
  userPrompt: string;
  context: ToolContext;
  temperature?: number;
}

export interface RenderPlanningModelPort {
  generate(request: RenderPlanningModelRequest): Promise<string>;
}
