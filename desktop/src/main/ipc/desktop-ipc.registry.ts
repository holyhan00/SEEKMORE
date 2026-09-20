import type { BrowserWindow } from 'electron';
import { registerClipboardIpc } from './clipboard-ipc';
import { registerReminderIpc } from './reminder-ipc';
import { registerRuntimeIpc } from './runtime-ipc';
import { registerWorkspaceIpc } from './workspace-ipc';
import { registerWindowIpc } from './window-ipc';
import type { ReminderRingCoordinator } from '../reminder/reminder-ring-coordinator';
import type {
  SeekmoreObjectPreviewWindowRestoreResult,
  SeekmoreObjectPreviewWindowResult,
} from '../../shared/desktop-api.types';

export function registerCoreDesktopIpc(input: {
  showDesktopWindow: () => Promise<BrowserWindow>;
  reminderRing: ReminderRingCoordinator;
  expandObjectPreview: (
    previewWidth: number,
  ) => Promise<SeekmoreObjectPreviewWindowResult>;
  restoreObjectPreview: () => Promise<SeekmoreObjectPreviewWindowRestoreResult>;
}): void {
  registerRuntimeIpc();
  registerWorkspaceIpc(input.showDesktopWindow);
  registerClipboardIpc();
  registerReminderIpc(input.reminderRing);
  registerWindowIpc({
    expandObjectPreview: input.expandObjectPreview,
    restoreObjectPreview: input.restoreObjectPreview,
  });
}
