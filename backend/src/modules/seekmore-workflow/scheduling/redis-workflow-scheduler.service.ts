import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import type { WorkflowScheduleRequest, WorkflowSchedulerPort } from './workflow-scheduler.port';

@Injectable()
export class RedisWorkflowSchedulerService implements WorkflowSchedulerPort, OnModuleDestroy {
  private readonly listeners = new Set<(request: WorkflowScheduleRequest) => void | Promise<void>>();

  constructor(private readonly redis: RedisService) {}

  async enqueue(request: WorkflowScheduleRequest): Promise<void> {
    const key = `seekmore:workflow:schedule:${request.workflowId}:${request.phaseId}`;
    await this.redis.set(key, JSON.stringify(request), 'EX', 24 * 60 * 60);
    for (const listener of this.listeners) {
      queueMicrotask(() => void Promise.resolve(listener(request)).catch(() => undefined));
    }
  }

  async remove(workflowId: string, phaseIds: string[]): Promise<void> {
    await Promise.all([...new Set(phaseIds)].filter(Boolean).map((phaseId) =>
      this.redis.del(`seekmore:workflow:schedule:${workflowId}:${phaseId}`),
    ));
  }

  subscribe(handler: (request: WorkflowScheduleRequest) => void | Promise<void>): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  onModuleDestroy(): void {
    this.listeners.clear();
  }
}
