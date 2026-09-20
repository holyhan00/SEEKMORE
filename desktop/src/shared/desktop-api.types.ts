export type SeekmoreDesktopPlatform = "darwin" | "win32" | "linux";

export type SeekmoreDesktopEnvironment = {
  isDesktop: true;
  platform: SeekmoreDesktopPlatform;
};

export type SeekmoreDesktopDirectorySelection = {
  canceled: boolean;
  rootPath: string | null;
  name: string | null;
};

export type SeekmoreDesktopBridgePing = { ok: true; bridgeVersion: number };

export type SeekmoreDesktopCapabilities = {
  workspace: boolean;
  clipboardWrite: boolean;
  reminderRing: boolean;
  webRuntime: boolean;
  mcpStdio: boolean;
};

export type SeekmoreClipboardWriteResult = {
  ok: boolean;
  errorCode?: string;
};

export type SeekmoreReminderRingRequest = {
  notificationId: string;
  durationMs?: number;
};

export type SeekmoreReminderStopRequest = {
  notificationId: string;
};

export type SeekmoreReminderRingResult = {
  ok: boolean;
  notificationId: string;
  active: boolean;
  durationMs: number;
  errorCode?: string;
};

export type SeekmoreObjectPreviewWindowResult = {
  expanded: boolean;
  previewWidth: number;
};

export type SeekmoreObjectPreviewWindowRestoreResult = {
  restored: boolean;
};

export type SeekmoreDesktopApi = {
  ping(): Promise<SeekmoreDesktopBridgePing>;
  getEnvironment(): SeekmoreDesktopEnvironment;
  getCapabilities(): Promise<SeekmoreDesktopCapabilities>;
  workspace: {
    selectDirectory(): Promise<SeekmoreDesktopDirectorySelection>;
  };
  clipboard: {
    writeText(text: string): Promise<SeekmoreClipboardWriteResult>;
  };
  reminder: {
    ring(request: SeekmoreReminderRingRequest): Promise<SeekmoreReminderRingResult>;
    stopRing(
      request: SeekmoreReminderStopRequest,
    ): Promise<SeekmoreReminderRingResult>;
  };
  window: {
    expandObjectPreview(
      previewWidth: number,
    ): Promise<SeekmoreObjectPreviewWindowResult>;
    restoreObjectPreview(): Promise<SeekmoreObjectPreviewWindowRestoreResult>;
  };
  web: {
    openExternal(url: string): Promise<{ opened: boolean }>;
  };
};
