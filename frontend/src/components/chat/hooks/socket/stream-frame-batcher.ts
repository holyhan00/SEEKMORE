                                                                    

export type StreamFrameBatcher<T> = {
  enqueue(value: T): void;
  flushKey(key: string): Promise<void>;
  discardKey(key: string): void;
  dispose(): void;
};

type Scheduler = {
  request(callback: () => void): number;
  cancel(handle: number): void;
};

export function createStreamFrameBatcher<T>(options: {
  keyOf(value: T): string;
  merge(current: T, incoming: T): T;
  consume(value: T): Promise<void> | void;
}): StreamFrameBatcher<T> {
  const scheduler = resolveScheduler();
  const pending = new Map<string, T>();

  let frameHandle: number | null = null;
  let disposed = false;
  let draining: Promise<void> = Promise.resolve();

  const queueDrain = (values: T[]): Promise<void> => {
    if (!values.length || disposed) {
      return draining;
    }

    draining = draining.then(async () => {
      for (const value of values) {
        await options.consume(value);
      }
    });

    return draining;
  };

  const schedule = (): void => {
    if (frameHandle !== null || disposed) {
      return;
    }

    frameHandle = scheduler.request(() => {
      frameHandle = null;

      if (disposed) {
        pending.clear();
        return;
      }

      const values = [...pending.values()];
      pending.clear();

      void queueDrain(values);
    });
  };

  return {
    enqueue(value): void {
      if (disposed) {
        return;
      }

      const key = options.keyOf(value);

      if (!key) {
        return;
      }

      const current = pending.get(key);

      pending.set(
        key,
        current ? options.merge(current, value) : value,
      );

      schedule();
    },

    async flushKey(key): Promise<void> {
      if (!key || disposed) {
        return;
      }

      const value = pending.get(key);

      if (value) {
        pending.delete(key);
        await queueDrain([value]);
        return;
      }

      await draining;
    },

    discardKey(key): void {
      if (!key) {
        return;
      }

      pending.delete(key);
    },

    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      pending.clear();

      if (frameHandle !== null) {
        scheduler.cancel(frameHandle);
      }

      frameHandle = null;
    },
  };
}

function resolveScheduler(): Scheduler {
  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function' &&
    typeof window.cancelAnimationFrame === 'function'
  ) {
    return {
      request: (callback) =>
        window.requestAnimationFrame(() => {
          callback();
        }),

      cancel: (handle) => {
        window.cancelAnimationFrame(handle);
      },
    };
  }

  return {
    request: (callback) => {
      return window.setTimeout(() => {
        callback();
      }, 16);
    },

    cancel: (handle) => {
      window.clearTimeout(handle);
    },
  };
}

