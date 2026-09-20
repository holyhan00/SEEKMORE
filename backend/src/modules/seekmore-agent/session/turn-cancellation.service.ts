import { Injectable } from '@nestjs/common';

@Injectable()
export class TurnCancellationService {
  private readonly controllers = new Map<string, AbortController>();
  private readonly externalCleanups = new Map<string, () => void>();

  register(traceId: string, external?: AbortSignal): AbortSignal {
    return this.registerOrGet(traceId, external);
  }

  registerOrGet(traceId: string, external?: AbortSignal): AbortSignal {
    const existing = this.controllers.get(traceId);
    if (existing) return existing.signal;
    const controller = new AbortController();
    if (external) {
      if (external.aborted) {
        controller.abort(external.reason);
      } else {
        const onAbort = () => controller.abort(external.reason);
        external.addEventListener('abort', onAbort, { once: true });
        this.externalCleanups.set(traceId, () => external.removeEventListener('abort', onAbort));
      }
    }
    this.controllers.set(traceId, controller);
    return controller.signal;
  }

  getSignal(traceId: string): AbortSignal | null {
    return this.controllers.get(traceId)?.signal ?? null;
  }

  async cancel(traceId: string, reason = 'cancelled'): Promise<boolean> {
    const controller = this.controllers.get(traceId);
    if (!controller) return false;
    controller.abort(reason);
    return true;
  }

  clear(traceId: string): void {
    this.externalCleanups.get(traceId)?.();
    this.externalCleanups.delete(traceId);
    this.controllers.delete(traceId);
  }
}
