                                                         

import type { ReminderAudioPlayer } from './reminder-audio-player';

export type ReminderRingRequest = {
  notificationId: string;
  durationMs?: number;
};

export type ReminderRingResult = {
  ok: boolean;
  notificationId: string;
  active: boolean;
  durationMs: number;
  errorCode?: string;
};

const RING_DURATION_MS = 10_000;

export class ReminderRingCoordinator {
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly audioPlayer: ReminderAudioPlayer,
  ) {}

  ring(request: ReminderRingRequest): ReminderRingResult {
    const notificationId = normalizeNotificationId(
      request.notificationId,
    );

    if (!notificationId) {
      return {
        ok: false,
        notificationId: '',
        active: false,
        durationMs: RING_DURATION_MS,
        errorCode: 'INVALID_NOTIFICATION_ID',
      };
    }

    if (this.expiryTimers.has(notificationId)) {
      return {
        ok: true,
        notificationId,
        active: true,
        durationMs: RING_DURATION_MS,
      };
    }

    this.expiryTimers.set(
      notificationId,
      setTimeout(() => {
        this.stop(notificationId);
      }, RING_DURATION_MS),
    );

    this.ensureAudio();

    return {
      ok: true,
      notificationId,
      active: true,
      durationMs: RING_DURATION_MS,
    };
  }

  stop(notificationIdValue: string): ReminderRingResult {
    const notificationId =
      normalizeNotificationId(notificationIdValue);

    const timer = notificationId
      ? this.expiryTimers.get(notificationId)
      : undefined;

    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(notificationId);
    }

    if (this.expiryTimers.size === 0) {
      this.stopAudio();
    }

    return {
      ok: true,
      notificationId,
      active: this.expiryTimers.has(notificationId),
      durationMs: 0,
    };
  }

  stopAll(): void {
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer);
    }

    this.expiryTimers.clear();

    this.stopAudio();
  }

  dispose(): void {
    this.stopAll();
    this.audioPlayer.dispose();
  }

  private ensureAudio(): void {
    const started = this.audioPlayer.start();

    if (!started) {
      console.error(
        '[DesktopReminder] Audio playback unavailable',
      );
    }
  }

  private stopAudio(): void {
    this.audioPlayer.stop();
  }
}

function normalizeNotificationId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (!normalized || normalized.length > 240) {
    return '';
  }

  return normalized;
}