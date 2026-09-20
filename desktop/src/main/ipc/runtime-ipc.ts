import { ipcMain } from 'electron';
import { SEEKMORE_DESKTOP_IPC } from '../../shared/desktop-ipc.channels';
import type { SeekmoreDesktopCapabilities } from '../../shared/desktop-api.types';

const DESKTOP_CAPABILITIES: SeekmoreDesktopCapabilities = Object.freeze({
  workspace: true,
  clipboardWrite: true,
  reminderRing: true,
  webRuntime: true,
  mcpStdio: true,
});

export function registerRuntimeIpc(): void {
  ipcMain.handle(SEEKMORE_DESKTOP_IPC.runtimePing, () => ({
    ok: true,
    bridgeVersion: 1,
  }));
  ipcMain.handle(
    SEEKMORE_DESKTOP_IPC.runtimeCapabilities,
    () => ({ ...DESKTOP_CAPABILITIES }),
  );
}
