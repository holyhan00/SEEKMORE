export interface DesktopMcpSetup {
  kind: string;
  releaseKey: string;
  [key: string]: unknown;
}

export type DesktopMcpSetupLog = (
  stage: string,
  fields: Record<string, unknown>,
) => void;

export interface DesktopMcpSetupContext {
  installationId: string;
  displayName: string;
  log: DesktopMcpSetupLog;
  warn: DesktopMcpSetupLog;
}

export interface DesktopMcpSetupResult {
  kind: string;
  releaseKey: string;
  ready: boolean;
  [key: string]: unknown;
}

export interface DesktopMcpSetupAdapter<
  TSetup extends DesktopMcpSetup = DesktopMcpSetup,
> {
  readonly kind: string;
  validate(value: unknown): TSetup;
  prepare(
    setup: TSetup,
    context: DesktopMcpSetupContext,
  ): Promise<DesktopMcpSetupResult>;
}

export type DesktopMcpSetupError = Error & {
  code: string;
  detail?: Record<string, unknown>;
};
