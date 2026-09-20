import { ipcMain } from 'electron';
import { SEEKMORE_DESKTOP_IPC } from '../../shared/desktop-ipc.channels';
import type {
  SeekmoreObjectPreviewWindowRestoreResult,
  SeekmoreObjectPreviewWindowResult,
} from '../../shared/desktop-api.types';

export function registerWindowIpc(input: {
  expandObjectPreview: (
    previewWidth: number,
  ) => Promise<SeekmoreObjectPreviewWindowResult>;
  restoreObjectPreview: () => Promise<SeekmoreObjectPreviewWindowRestoreResult>;
}): void {
  ipcMain.handle(
    SEEKMORE_DESKTOP_IPC.windowExpandObjectPreview,
    async (_event, value: unknown) =>
      input.expandObjectPreview(
        Number(value),
      ),
  );

  ipcMain.handle(
    SEEKMORE_DESKTOP_IPC.windowRestoreObjectPreview,
    async () => input.restoreObjectPreview(),
  );
}
