import type { RenderPayload, RenderToolName } from '../../render.types';

export type RenderPlanKind = 'document' | 'spreadsheet';
export type RenderPlanFormat = 'docx' | 'pdf' | 'xlsx';


export interface RenderPlanningSource {
  content?: string;
  markdown?: string;
  data?: unknown;
  blocks?: unknown[];
  references?: unknown[];
  assets?: unknown[];
}

export interface RenderPlanningRequirements {
  content?: string[];
  layout?: string[];
  style?: string[];
  forbidden?: string[];
}

export interface RenderPlanningRequest {
                                                                            
  plan?: RenderPlanBase;
  kind: RenderPlanKind;
  instruction: string;
  source?: RenderPlanningSource;
  requirements?: RenderPlanningRequirements;
  output: {
    format: RenderPlanFormat;
    filename?: string;
  };
  context?: {
    locale?: string;
    audience?: string;
    usage?: string;
  };
  meta?: Record<string, unknown>;
}

export interface RenderPlanObjective {
  purpose: string;
  audience?: string;
  usage?: string;
  language?: string;
}

export interface RenderPlanOutput {
  format: RenderPlanFormat;
  filename: string;
}

export interface RenderPlanBase {
  version: 'render-plan/v1';
  kind: RenderPlanKind;
  objective: RenderPlanObjective;
  design: Record<string, unknown>;
  output: RenderPlanOutput;
  rationale?: {
    structure?: string;
    design?: string;
  };
}

export interface CompiledRenderPlan<TPlan extends RenderPlanBase = RenderPlanBase> {
  plan: TPlan;
  toolName: RenderToolName;
  payload: RenderPayload;
  filename: string;
  diagnostics: import('./render-plan-diagnostics.types').RenderPlanDiagnostic[];
  attempts: number;
}
