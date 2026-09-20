                                       
import { ipcMain } from 'electron';
import { SEEKMORE_DESKTOP_IPC } from '../../shared/desktop-ipc.channels';
import type { ReminderRingCoordinator } from '../reminder/reminder-ring-coordinator';

export function registerReminderIpc(
  coordinator: ReminderRingCoordinator,
): void {
  ipcMain.handle(
    SEEKMORE_DESKTOP_IPC.reminderRing,
    (_event, request: unknown) => {
      const input = asRecord(request);
      return coordinator.ring({
        notificationId: String(input.notificationId ?? ''),
        durationMs: Number(input.durationMs),
      });
    },
  );

  ipcMain.handle(
    SEEKMORE_DESKTOP_IPC.reminderStopRing,
    (_event, request: unknown) => {
      const input = asRecord(request);
      return coordinator.stop(String(input.notificationId ?? ''));
    },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
