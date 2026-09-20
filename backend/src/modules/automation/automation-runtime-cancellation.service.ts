import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { TurnCancellationService } from '../seekmore-agent/session/turn-cancellation.service';
import { TurnResourceRegistry } from '../runtime-cancellation/turn-resource.registry';
import { AutomationControlBus } from './automation-control.bus';

@Injectable()
export class AutomationRuntimeCancellationService implements OnModuleInit, OnModuleDestroy {
  private subscription?: Subscription;

  constructor(
    private readonly control: AutomationControlBus,
    private readonly cancellations: TurnCancellationService,
    private readonly resources: TurnResourceRegistry,
  ) {}

  onModuleInit(): void {
    this.subscription = this.control.cancelRequests$.subscribe((event) => {
      for (const traceId of event.traceIds) {
        void this.cancelTrace(traceId, event.reason);
      }
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private async cancelTrace(traceId: string, reason: string): Promise<void> {
    await Promise.allSettled([
      this.cancellations.cancel(traceId, reason),
      this.resources.cancelTrace(traceId, reason),
    ]);
  }
}
