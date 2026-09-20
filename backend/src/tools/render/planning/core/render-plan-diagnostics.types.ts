export type RenderPlanStage =
  | 'planning'
  | 'parsing'
  | 'validation'
  | 'compilation'
  | 'rendering'
  | 'verification'
  | 'delivery';

export type RenderPlanDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface RenderPlanDiagnostic {
  stage: RenderPlanStage;
  code: string;
  message: string;
  path?: string;
  severity: RenderPlanDiagnosticSeverity;
  repairable: boolean;
  detail?: Record<string, unknown>;
}

export type RenderStageResult<T> =
  | {
      ok: true;
      value: T;
      diagnostics: RenderPlanDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: RenderPlanDiagnostic[];
    };

export function success<T>(
  value: T,
  diagnostics: RenderPlanDiagnostic[] = [],
): RenderStageResult<T> {
  return { ok: true, value, diagnostics };
}

export function failure<T = never>(
  diagnostics: RenderPlanDiagnostic[],
): RenderStageResult<T> {
  return { ok: false, diagnostics };
}
