export type DesktopRuntimePhase =
  | 'unknown'
  | 'web'
  | 'desktop-bridge-error'
  | 'desktop-ready';

export type DesktopCapabilities = {
  workspace: boolean;
  clipboardWrite: boolean;
  reminderRing: boolean;
  webRuntime: boolean;
};

export type DesktopRuntimeError = {
  code: 'BRIDGE_MISSING' | 'BRIDGE_HANDSHAKE_FAILED';
  message: string;
};

export type DesktopRuntimeState = {
  phase: DesktopRuntimePhase;
  isDesktop: boolean;
  bridgeReady: boolean;
  environment: {
    isDesktop: true;
    platform: 'darwin' | 'win32' | 'linux';
  } | null;
  capabilities: DesktopCapabilities;
  error: DesktopRuntimeError | null;
};

export const EMPTY_DESKTOP_CAPABILITIES: DesktopCapabilities = Object.freeze({
  workspace: false,
  clipboardWrite: false,
  reminderRing: false,
  webRuntime: false,
});
