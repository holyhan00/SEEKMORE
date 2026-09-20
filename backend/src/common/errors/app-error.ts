export type AppErrorParam = string | number | boolean | null;

export interface AppErrorPayload {
  code: string;
  message: string;
  params?: Record<string, AppErrorParam>;
}

export function appError(
  code: string,
  params?: Record<string, AppErrorParam>,
): AppErrorPayload {
  const normalized = String(code ?? '').trim();
  return {
    code: normalized,
    message: normalized,
    ...(params && Object.keys(params).length > 0 ? { params } : {}),
  };
}
