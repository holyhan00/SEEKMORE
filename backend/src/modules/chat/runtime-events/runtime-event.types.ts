export interface RuntimeEventInput {
  type: string;
  eventId?: string | null;
  sequence?: number | null;
  level?: 'debug' | 'info' | 'warn' | 'error';
  stage?: string;
  status?: string | null;
  scope?: Record<string, unknown> | null;
  refs?: Record<string, unknown> | null;
  durationMs?: number | null;
  title?: string | null;
  message?: string | null;
  reasonCodes?: string[] | null;
  warnings?: string[] | null;
  payload?: Record<string, unknown> | null;
  source?: string;
}

export interface RuntimeEvent extends Required<Pick<RuntimeEventInput, 'type'>> {
  eventId: string;
  sequence: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  stage: string;
  status?: string | null;
  scope: Record<string, unknown>;
  refs: Record<string, unknown>;
  timing: { timestamp: string; durationMs?: number | null };
  title?: string | null;
  message?: string | null;
  reasonCodes: string[];
  warnings: string[];
  payload?: Record<string, unknown> | null;
  source: string;
}
