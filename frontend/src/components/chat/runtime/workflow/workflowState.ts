import { atomFamily } from 'recoil';
import type { ActiveWorkflowLoadState, ActiveWorkflowSnapshot } from './workflow.types';

export const emptyActiveWorkflowState = (): ActiveWorkflowLoadState => ({
  scopeKey: null,
  status: 'idle',
  snapshot: null,
  hydratedAt: null,
  lastWorkflowId: null,
  lastRunVersion: null,
  lastUpdatedAt: null,
  error: null,
});

export function workflowStateFromSnapshot(
  scopeKey: string,
  snapshot: ActiveWorkflowSnapshot | null,
  hydratedAt = Date.now(),
  previous?: ActiveWorkflowLoadState,
): ActiveWorkflowLoadState {
  return {
    scopeKey,
    status: 'ready',
    snapshot,
    hydratedAt,
    lastWorkflowId: snapshot?.run.id ?? previous?.lastWorkflowId ?? null,
    lastRunVersion: snapshot?.run.version ?? previous?.lastRunVersion ?? null,
    lastUpdatedAt: snapshot
      ? Date.parse(snapshot.run.updatedAt) || hydratedAt
      : previous?.lastUpdatedAt ?? null,
    error: null,
  };
}

export const activeWorkflowState = atomFamily<ActiveWorkflowLoadState, string>({
  key: 'activeWorkflowState',
  default: emptyActiveWorkflowState(),
});
