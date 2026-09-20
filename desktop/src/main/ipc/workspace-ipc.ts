import { dialog, ipcMain } from 'electron';
import * as path from 'node:path';
import type { BrowserWindow } from 'electron';
import { SEEKMORE_DESKTOP_IPC } from '../../shared/desktop-ipc.channels';
import type { SeekmoreDesktopDirectorySelection } from '../../shared/desktop-api.types';

export function registerWorkspaceIpc(
  showDesktopWindow: () => Promise<BrowserWindow>,
): void {
  ipcMain.handle(
    SEEKMORE_DESKTOP_IPC.workspaceSelectDirectory,
    async (): Promise<SeekmoreDesktopDirectorySelection> => {
      const ownerWindow = await showDesktopWindow();
      const result = await dialog.showOpenDialog(ownerWindow, {
        title: '选择项目文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, rootPath: null, name: null };
      }

      const rootPath = path.resolve(result.filePaths[0]);
      return {
        canceled: false,
        rootPath,
        name: path.basename(rootPath) || rootPath,
      };
    },
  );
}
