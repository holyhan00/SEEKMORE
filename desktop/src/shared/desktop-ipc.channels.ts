export const SEEKMORE_DESKTOP_API_KEY = "seekmoreDesktop";
export const SEEKMORE_DESKTOP_IPC = Object.freeze({
  runtimePing: "seekmore:runtime:ping",
  runtimeCapabilities: "seekmore:runtime:capabilities",
  workspaceSelectDirectory: "seekmore:workspace:select-directory",
  clipboardWriteText: "seekmore:clipboard:write-text",
  reminderRing: "seekmore:reminder:ring",
  reminderStopRing: "seekmore:reminder:stop-ring",
  windowExpandObjectPreview: "seekmore:window:expand-object-preview",
  windowRestoreObjectPreview: "seekmore:window:restore-object-preview",
  windowTitleBarThemeChanged: "seekmore:window:title-bar-theme-changed",
  webOpenExternal: "seekmore:web:open-external",
});
export const SEEKMORE_DESKTOP_IPC_CHANNELS: readonly string[] = Object.freeze(
  Object.values(SEEKMORE_DESKTOP_IPC),
);
