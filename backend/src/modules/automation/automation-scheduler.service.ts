import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationService } from './automation.service';

@Injectable()
export class AutomationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationSchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly automations: AutomationService,
    private readonly runner: AutomationRunnerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const recovered = await this.automations.recoverInterruptedRuns();
    if (recovered > 0) this.logger.warn(`Recovered ${recovered} interrupted automation run(s)`);
    this.timer = setInterval(() => void this.tick(), this.intervalMs());
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.automations.expireDue(this.batchSize());
      const notices = await this.automations.pendingExpiryNotices(this.batchSize());
      for (const automation of notices) {
        await this.runner.publishExpiryNotice(automation).catch(() => false);
      }
      await this.automations.claimDue(this.batchSize());
      const pending = await this.automations.pendingRuns(this.batchSize());
      for (const run of pending) {
        if (this.inFlight.has(run.id)) continue;
        this.inFlight.add(run.id);
        void this.runner.execute(run.id)
          .catch((error) => {
            this.logger.warn(`Automation scheduler run failed run=${run.id}: ${error instanceof Error ? error.message : String(error)}`);
          })
          .finally(() => this.inFlight.delete(run.id));
      }
    } finally {
      this.ticking = false;
    }
  }

  private intervalMs(): number {
    const value = Number(process.env.AUTOMATION_SCHEDULER_INTERVAL_MS ?? 2_000);
    return Number.isFinite(value) ? Math.max(500, Math.min(Math.floor(value), 60_000)) : 2_000;
  }

  private batchSize(): number {
    const value = Number(process.env.AUTOMATION_SCHEDULER_BATCH_SIZE ?? 10);
    return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), 50)) : 10;
  }
}
