import { getLocalizationSnapshot } from '../../../../localization/LocalizationProvider';
                                                                         
type SchedulerHandle =
  | number
  | ReturnType<typeof setTimeout>;

export type ChatTextStreamScheduler = {
  request(callback: () => void): SchedulerHandle;
  cancel(handle: SchedulerHandle): void;
};

export type ChatTextStreamPresenter = {
  update(
    key: string,
    content: string,
    displayedContent?: string,
  ): void;
  complete(
    key: string,
    content: string,
    displayedContent?: string,
  ): Promise<string>;
  discard(key: string): void;
  dispose(): void;
};

type PresentationTrack = {
  displayed: string;
  target: string;
  pending: string[];
  completing: boolean;
  completionResolvers: Array<(content: string) => void>;
};

export function createChatTextStreamPresenter(options: {
  onFrame(key: string, content: string): void;
  scheduler?: ChatTextStreamScheduler;
}): ChatTextStreamPresenter {
  const scheduler =
    options.scheduler ?? resolveScheduler();
  const tracks =
    new Map<string, PresentationTrack>();

  let frameHandle: SchedulerHandle | null =
    null;
  let disposed = false;

  const schedule = (): void => {
    if (
      disposed
      || frameHandle !== null
      || !hasPendingText(tracks)
    ) {
      return;
    }

    frameHandle = scheduler.request(() => {
      frameHandle = null;

      if (disposed) {
        return;
      }

      for (const [key, track] of tracks) {
        if (!track.pending.length) {
          finishIfDrained(track);
          continue;
        }

        const count = charactersPerFrame(
          track.pending.length,
          track.completing,
        );
        track.displayed +=
          track.pending.splice(0, count).join('');

        options.onFrame(key, track.displayed);
        finishIfDrained(track);
      }

      schedule();
    });
  };

  const updateTarget = (
    key: string,
    content: string,
    displayedContent?: string,
  ): PresentationTrack => {
    const target = String(content ?? '');
    let track = tracks.get(key);

    if (!track) {
      const displayed =
        target.startsWith(
          String(displayedContent ?? ''),
        )
          ? String(displayedContent ?? '')
          : '';

      track = {
        displayed,
        target: displayed,
        pending: [],
        completing: false,
        completionResolvers: [],
      };
      tracks.set(key, track);
    }

    if (target === track.target) {
      return track;
    }

    if (target.startsWith(track.target)) {
      track.pending.push(
        ...splitGraphemes(
          target.slice(track.target.length),
        ),
      );
    } else if (target.startsWith(track.displayed)) {
      track.pending = splitGraphemes(
        target.slice(track.displayed.length),
      );
    } else {
      track.displayed = '';
      track.pending = splitGraphemes(target);
    }

    track.target = target;
    schedule();
    return track;
  };

  return {
    update(
      key,
      content,
      displayedContent,
    ): void {
      if (!key || disposed) {
        return;
      }

      updateTarget(
        key,
        content,
        displayedContent,
      );
    },

    complete(
      key,
      content,
      displayedContent,
    ): Promise<string> {
      if (!key || disposed) {
        return Promise.resolve(String(content ?? ''));
      }

      const track = updateTarget(
        key,
        content,
        displayedContent,
      );
      track.completing = true;

      if (!track.pending.length) {
        return Promise.resolve(track.displayed);
      }

      schedule();

      return new Promise<string>((resolve) => {
        track.completionResolvers.push(resolve);
      });
    },

    discard(key): void {
      const track = tracks.get(key);
      if (!track) {
        return;
      }

      resolveCompletion(track);
      tracks.delete(key);

      if (
        frameHandle !== null
        && !hasPendingText(tracks)
      ) {
        scheduler.cancel(frameHandle);
        frameHandle = null;
      }
    },

    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;

      if (frameHandle !== null) {
        scheduler.cancel(frameHandle);
        frameHandle = null;
      }

      for (const track of tracks.values()) {
        resolveCompletion(track);
      }

      tracks.clear();
    },
  };
}

function finishIfDrained(
  track: PresentationTrack,
): void {
  if (
    track.pending.length
    || !track.completing
  ) {
    return;
  }

  track.completing = false;
  resolveCompletion(track);
}

function resolveCompletion(
  track: PresentationTrack,
): void {
  const resolvers =
    track.completionResolvers.splice(0);

  for (const resolve of resolvers) {
    resolve(track.target);
  }
}

function hasPendingText(
  tracks: Map<string, PresentationTrack>,
): boolean {
  for (const track of tracks.values()) {
    if (track.pending.length) {
      return true;
    }
  }

  return false;
}

function charactersPerFrame(
  backlog: number,
  completing: boolean,
): number {
  const normal = backlog <= 12
    ? 1
    : backlog <= 32
      ? 2
      : backlog <= 80
        ? 4
        : Math.min(
            10,
            Math.ceil(backlog / 16),
          );

  if (!completing) {
    return normal;
  }

  return Math.max(
    normal,
    Math.min(
      24,
      Math.ceil(backlog / 12),
    ),
  );
}

function splitGraphemes(
  value: string,
): string[] {
  const Segmenter =
    (
      Intl as unknown as {
        Segmenter?: new (
          locale?: string,
          options?: {
            granularity: 'grapheme';
          },
        ) => {
          segment(input: string): Iterable<{
            segment: string;
          }>;
        };
      }
    ).Segmenter;

  if (Segmenter) {
    const segmenter = new Segmenter(
      getLocalizationSnapshot().formatLocale,
      {
        granularity: 'grapheme',
      },
    );

    return Array.from(
      segmenter.segment(value),
      (entry) => entry.segment,
    );
  }

  return Array.from(value);
}

function resolveScheduler(): ChatTextStreamScheduler {
  if (
    typeof window !== 'undefined'
    && typeof window.requestAnimationFrame
      === 'function'
    && typeof window.cancelAnimationFrame
      === 'function'
  ) {
    return {
      request: (callback) =>
        window.requestAnimationFrame(callback),
      cancel: (handle) =>
        window.cancelAnimationFrame(
          handle as number,
        ),
    };
  }

  return {
    request: (callback) =>
      setTimeout(callback, 16),
    cancel: (handle) =>
      clearTimeout(
        handle as ReturnType<typeof setTimeout>,
      ),
  };
}
