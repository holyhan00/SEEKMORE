import { clipboard, ipcMain } from 'electron';
import { SEEKMORE_DESKTOP_IPC } from '../../shared/desktop-ipc.channels';
import type { SeekmoreClipboardWriteResult } from '../../shared/desktop-api.types';

const MAX_CLIPBOARD_TEXT_LENGTH = 5_000_000;

export function registerClipboardIpc(): void {
  ipcMain.handle(
    SEEKMORE_DESKTOP_IPC.clipboardWriteText,
    (_event, value: unknown): SeekmoreClipboardWriteResult => {
      if (typeof value !== 'string') {
        return { ok: false, errorCode: 'INVALID_TEXT' };
      }
      if (value.length > MAX_CLIPBOARD_TEXT_LENGTH) {
        return { ok: false, errorCode: 'TEXT_TOO_LARGE' };
      }

      try {
        clipboard.writeText(value, 'clipboard');
        return { ok: true };
      } catch (error) {
        console.error('[DesktopClipboard] Failed to write text', error);
        return { ok: false, errorCode: 'WRITE_FAILED' };
      }
    },
  );
}
