import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WorkflowRunRepository } from '../persistence/workflow-run.repository';
import type { WorkflowRunSnapshot } from '../contracts/workflow-run.types';

export interface WorkflowLeaseHandle {
  workflowId: string;
  owner: string;
  fencingToken: bigint;
  expiresAt: Date;
}

@Injectable()
export class WorkflowLeaseService {
  private readonly ttlMs = 45_000;
  constructor(private readonly runs: WorkflowRunRepository) {}

  async acquire(workflowId: string, owner = `workflow-worker:${randomUUID()}`): Promise<WorkflowLeaseHandle> {
    const run = await this.runs.acquireLease({ workflowId, owner, ttlMs: this.ttlMs });
    return { workflowId, owner, fencingToken: run.fencingToken, expiresAt: run.leaseExpiresAt ?? new Date(Date.now() + this.ttlMs) };
  }

  async heartbeat(handle: WorkflowLeaseHandle): Promise<void> {
    const ok = await this.runs.heartbeatLease({ workflowId: handle.workflowId, owner: handle.owner,
      fencingToken: handle.fencingToken, ttlMs: this.ttlMs });
    if (!ok) throw new Error('WORKFLOW_LEASE_LOST');
    handle.expiresAt = new Date(Date.now() + this.ttlMs);
  }

  release(handle: WorkflowLeaseHandle): Promise<void> {
    return this.runs.releaseLease(handle);
  }

  async withLease<T>(workflowId: string, work: (lease: WorkflowLeaseHandle) => Promise<T>): Promise<T> {
    const lease = await this.acquire(workflowId);
    const heartbeat = setInterval(() => void this.heartbeat(lease).catch(() => undefined), Math.floor(this.ttlMs / 3));
    heartbeat.unref?.();
    try { return await work(lease); }
    finally { clearInterval(heartbeat); await this.release(lease).catch(() => undefined); }
  }

  assertFencing(run: WorkflowRunSnapshot, handle: WorkflowLeaseHandle): void {
    const expired = !run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= Date.now();
    if (
      run.fencingToken !== handle.fencingToken ||
      run.leaseOwner !== handle.owner ||
      expired
    ) {
      throw new Error('WORKFLOW_STALE_FENCING_TOKEN');
    }
  }
}
