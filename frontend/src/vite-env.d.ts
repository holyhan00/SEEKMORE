/// <reference types="vite/client" />

type SeekmoreDesktopPlatform = 'darwin' | 'win32' | 'linux';
type SeekmoreDesktopCapabilities = {
  workspace: boolean;
  clipboardWrite: boolean;
  reminderRing: boolean;
  webRuntime: boolean;
};
type SeekmoreDesktopDirectorySelection = {
  canceled: boolean;
  rootPath: string | null;
  name: string | null;
};
type SeekmoreDesktopUploadSelectionRequest = {
  allowDirectories: boolean;
  multiple?: boolean;
};
type SeekmoreDesktopUploadFile = {
  name: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  lastModified: number;
  contentBase64: string;
};
type SeekmoreDesktopUploadSelection = {
  canceled: boolean;
  selectionKind: 'FILES' | 'DIRECTORY';
  files: SeekmoreDesktopUploadFile[];
};
type SeekmoreDesktopApi = {
  ping(): Promise<{ ok: true; bridgeVersion: number }>;
  getEnvironment(): { isDesktop: true; platform: SeekmoreDesktopPlatform };
  getCapabilities(): Promise<SeekmoreDesktopCapabilities>;
  workspace: {
    selectDirectory(): Promise<SeekmoreDesktopDirectorySelection>;
  };
  files: {
    selectForUpload(
      request: SeekmoreDesktopUploadSelectionRequest,
    ): Promise<SeekmoreDesktopUploadSelection>;
  };
  clipboard: {
    writeText(text: string): Promise<{ ok: boolean; errorCode?: string }>;
  };
  reminder: {
    ring(request: { notificationId: string; durationMs?: number }): Promise<{
      ok: boolean;
      notificationId: string;
      active: boolean;
      durationMs: number;
      errorCode?: string;
    }>;
    stopRing(request: { notificationId: string }): Promise<{
      ok: boolean;
      notificationId: string;
      active: boolean;
      durationMs: number;
      errorCode?: string;
    }>;
  };
  window: {
    expandObjectPreview(previewWidth: number): Promise<{
      expanded: boolean;
      previewWidth: number;
    }>;
    restoreObjectPreview(): Promise<{ restored: boolean }>;
  };
  web: {
    openExternal(url: string): Promise<{ opened: boolean }>;
  };
};
type SeekmoreDesktopBootstrap = {
  host: 'web' | 'desktop';
  bridge: 'none' | 'missing' | 'ready';
};
interface Window {
  seekmoreDesktop?: SeekmoreDesktopApi;
  __SEEKMORE_DESKTOP_BOOTSTRAP__?: SeekmoreDesktopBootstrap;
}
