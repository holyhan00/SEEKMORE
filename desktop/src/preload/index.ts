import { contextBridge, ipcRenderer } from "electron";
import type {
  SeekmoreDesktopApi,
  SeekmoreDesktopCapabilities,
  SeekmoreDesktopDirectorySelection,
  SeekmoreDesktopEnvironment,
  SeekmoreReminderRingRequest,
  SeekmoreReminderStopRequest,
} from "../shared/desktop-api.types";
import {
  SEEKMORE_DESKTOP_API_KEY,
  SEEKMORE_DESKTOP_IPC,
} from "../shared/desktop-ipc.channels";

const SKILL_FILE_SELECT_FOR_UPLOAD = "seekmore:skill-files:select-for-upload";
type UploadRequest = { allowDirectories: boolean; multiple?: boolean };
type UploadFile = {
  name: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  lastModified: number;
  contentBase64: string;
};
type UploadSelection = {
  canceled: boolean;
  selectionKind: "FILES" | "DIRECTORY";
  files: UploadFile[];
};
type DesktopApiWithFiles = SeekmoreDesktopApi & {
  files: { selectForUpload(request: UploadRequest): Promise<UploadSelection> };
};

const environment: SeekmoreDesktopEnvironment = Object.freeze({
  isDesktop: true,
  platform: supportedPlatform(process.platform),
});

if (
  process.platform === "win32"
  && process.argv.includes("--seekmore-windows-title-bar-overlay")
) {
  installWindowsTitleBarOverlayBridge();
}

const desktopApi: DesktopApiWithFiles = Object.freeze({
  ping: () => ipcRenderer.invoke(SEEKMORE_DESKTOP_IPC.runtimePing),
  getEnvironment: () => ({ ...environment }),
  getCapabilities: async (): Promise<SeekmoreDesktopCapabilities> =>
    normalizeCapabilities(
      await ipcRenderer.invoke(SEEKMORE_DESKTOP_IPC.runtimeCapabilities),
    ),
  workspace: Object.freeze({
    selectDirectory: async (): Promise<SeekmoreDesktopDirectorySelection> =>
      normalizeDirectorySelection(
        await ipcRenderer.invoke(SEEKMORE_DESKTOP_IPC.workspaceSelectDirectory),
      ),
  }),
  files: Object.freeze({
    selectForUpload: async (request: UploadRequest): Promise<UploadSelection> =>
      normalizeUploadSelection(
        await ipcRenderer.invoke(SKILL_FILE_SELECT_FOR_UPLOAD, request),
      ),
  }),
  clipboard: Object.freeze({
    writeText: async (text: string) =>
      normalizeClipboardResult(
        await ipcRenderer.invoke(SEEKMORE_DESKTOP_IPC.clipboardWriteText, text),
      ),
  }),
  reminder: Object.freeze({
    ring: async (request: SeekmoreReminderRingRequest) =>
      ipcRenderer.invoke(SEEKMORE_DESKTOP_IPC.reminderRing, request),
    stopRing: async (request: SeekmoreReminderStopRequest) =>
      ipcRenderer.invoke(SEEKMORE_DESKTOP_IPC.reminderStopRing, request),
  }),
  window: Object.freeze({
    expandObjectPreview: (previewWidth: number) =>
      ipcRenderer.invoke(
        SEEKMORE_DESKTOP_IPC.windowExpandObjectPreview,
        previewWidth,
      ),
    restoreObjectPreview: () =>
      ipcRenderer.invoke(
        SEEKMORE_DESKTOP_IPC.windowRestoreObjectPreview,
      ),
  }),
  web: Object.freeze({
    openExternal: (url: string) =>
      ipcRenderer.invoke(SEEKMORE_DESKTOP_IPC.webOpenExternal, url),
  }),
});

contextBridge.exposeInMainWorld(SEEKMORE_DESKTOP_API_KEY, desktopApi);

function installWindowsTitleBarOverlayBridge(): void {
  const publishTheme = () => {
    const theme = document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light";

    document.documentElement.dataset.windowsTitleBarOverlay = "true";

    ipcRenderer.send(
      SEEKMORE_DESKTOP_IPC.windowTitleBarThemeChanged,
      theme,
    );
  };

  const installSafeArea = () => {
    if (!document.getElementById("seekmore-windows-titlebar-overlay-style")) {
      const style = document.createElement("style");
      style.id = "seekmore-windows-titlebar-overlay-style";
      style.textContent = `
        html[data-runtime='desktop'][data-windows-title-bar-overlay='true'] [data-desktop-drag-region] {
          padding-right: 142px;
          box-sizing: border-box;
        }
      `;
      document.head.appendChild(style);
    }

    publishTheme();

    const observer = new MutationObserver(() => publishTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", installSafeArea, { once: true });
  } else {
    installSafeArea();
  }
}

function supportedPlatform(
  value: string,
): SeekmoreDesktopEnvironment["platform"] {
  if (value === "win32" || value === "linux") return value;
  return "darwin";
}
function normalizeCapabilities(value: unknown): SeekmoreDesktopCapabilities {
  const row = asRecord(value);
  return {
    workspace: row.workspace === true,
    clipboardWrite: row.clipboardWrite === true,
    reminderRing: row.reminderRing === true,
    webRuntime: row.webRuntime === true,
    mcpStdio: row.mcpStdio === true,
  };
}
function normalizeDirectorySelection(
  value: unknown,
): SeekmoreDesktopDirectorySelection {
  const row = asRecord(value);
  return {
    canceled: row.canceled !== false,
    rootPath: typeof row.rootPath === "string" ? row.rootPath : null,
    name: typeof row.name === "string" ? row.name : null,
  };
}
function normalizeClipboardResult(value: unknown) {
  const row = asRecord(value);
  return {
    ok: row.ok === true,
    ...(typeof row.errorCode === "string" ? { errorCode: row.errorCode } : {}),
  };
}
function normalizeUploadSelection(value: unknown): UploadSelection {
  const row = asRecord(value);
  const files = Array.isArray(row.files)
    ? row.files.map((item) => {
        const file = asRecord(item);
        return {
          name: String(file.name ?? ""),
          relativePath: String(file.relativePath ?? ""),
          mimeType: String(file.mimeType ?? "application/octet-stream"),
          sizeBytes: Number(file.sizeBytes ?? 0),
          lastModified: Number(file.lastModified ?? 0),
          contentBase64: String(file.contentBase64 ?? ""),
        };
      })
    : [];
  return {
    canceled: row.canceled !== false,
    selectionKind: row.selectionKind === "DIRECTORY" ? "DIRECTORY" : "FILES",
    files,
  };
}
function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
