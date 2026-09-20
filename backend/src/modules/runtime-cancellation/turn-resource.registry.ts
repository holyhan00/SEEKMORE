import { Injectable } from '@nestjs/common';
import type { CancelableTurnResource } from './turn-resource.types';

@Injectable()
export class TurnResourceRegistry {
  private readonly traces = new Map<string, Map<string, CancelableTurnResource>>();

  register(traceId: string, resource: CancelableTurnResource): () => void {
    if (!traceId) return () => undefined;
    const resources = this.traces.get(traceId) ?? new Map<string, CancelableTurnResource>();
    resources.set(resource.resourceId, resource);
    this.traces.set(traceId, resources);
    return () => this.unregister(traceId, resource.resourceId);
  }

  unregister(traceId: string, resourceId: string): void {
    const resources = this.traces.get(traceId);
    resources?.delete(resourceId);
    if (resources?.size === 0) this.traces.delete(traceId);
  }

  async cancelTrace(traceId: string, reason: string): Promise<PromiseSettledResult<void>[]> {
    const resources = [...(this.traces.get(traceId)?.values() ?? [])];
    const results = await Promise.allSettled(resources.map((resource) => resource.cancel(reason)));
    this.traces.delete(traceId);
    return results;
  }

  hasActiveResources(traceId: string): boolean {
    return Boolean(this.traces.get(traceId)?.size);
  }

  snapshot(traceId: string): Array<{ resourceId: string; kind: string }> {
    return [...(this.traces.get(traceId)?.values() ?? [])].map(({ resourceId, kind }) => ({ resourceId, kind }));
  }
}
