import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRecoilState } from 'recoil';
import { getActiveWorkflow } from './workflow.api';
import {
  activeWorkflowState,
  emptyActiveWorkflowState,
  workflowStateFromSnapshot,
} from './workflowState';
import type {
  ActiveWorkflowLoadState,
  ActiveWorkflowSnapshot,
  WorkflowRealtimeEvent,
} from './workflow.types';

const WORKFLOW_CHANGED_EVENT = 'chat:workflow:changed';
const WORKFLOW_REFRESH_EVENT = 'chat:workflow:refresh';
const SOCKET_CONNECTED_EVENT = 'chat:socket:connected';
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function useActiveWorkflow(
  agentId: string | null | undefined,
  conversationId: string | null | undefined,
) {
  const aid = String(agentId ?? '').trim();
  const cid = String(conversationId ?? '').trim();
  const scopeKey = aid && cid ? `${aid}:${cid}` : '__no_workflow_scope__';
  const [state, setState] = useRecoilState(activeWorkflowState(scopeKey));
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    if (!aid || !cid || cid.startsWith('temp-')) return;
    const baseline = revisionOfState(stateRef.current);
    setState((previous) => ({
      ...previous,
      scopeKey,
      status: previous.hydratedAt ? 'refreshing' : 'loading',
      error: null,
    }));
    try {
      const snapshot = await getActiveWorkflow(aid, cid);
      setState((previous) => {
        if (previous.scopeKey !== scopeKey || revisionAdvanced(previous, baseline)) {
          return { ...previous, status: 'ready', error: null };
        }
        if (snapshot && compareSnapshotToState(snapshot, previous) < 0) {
          return { ...previous, status: 'ready', error: null };
        }
        if (!snapshot && previous.snapshot && TERMINAL_STATUSES.has(previous.snapshot.run.status)) {
          return { ...previous, scopeKey, status: 'ready', error: null };
        }
        return workflowStateFromSnapshot(scopeKey, snapshot, Date.now(), previous);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((previous) => ({
        ...previous,
        scopeKey,
        status: previous.snapshot ? 'ready' : 'error',
        error: message,
      }));
    }
  }, [aid, cid, scopeKey, setState]);

  useEffect(() => {
    if (aid && cid && !cid.startsWith('temp-')) return;
    setState(emptyActiveWorkflowState());
  }, [aid, cid, setState]);

  useEffect(() => {
    const onWorkflowChanged = (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<unknown>).detail;
      if (!isWorkflowRealtimeEvent(detail)) {
        void refresh();
        return;
      }
      if (detail.agentId !== aid || detail.conversationId !== cid) return;

      setState((previous) => {
        if (compareEventToState(detail, previous) <= 0) return previous;
        const revision = revisionOfEvent(detail);
        if (detail.reason === 'deleted') {
          return {
            ...previous,
            scopeKey,
            status: 'ready',
            snapshot: null,
            hydratedAt: Date.now(),
            lastWorkflowId: detail.workflowId,
            lastRunVersion: revision.runVersion,
            lastUpdatedAt: revision.updatedAt,
            error: null,
          };
        }
        return {
          ...workflowStateFromSnapshot(scopeKey, eventToSnapshot(detail), Date.now(), previous),
          lastRunVersion: revision.runVersion,
          lastUpdatedAt: revision.updatedAt,
        };
      });
    };
    const requestRefresh = () => { void refresh(); };
    window.addEventListener(WORKFLOW_CHANGED_EVENT, onWorkflowChanged as EventListener);
    window.addEventListener(WORKFLOW_REFRESH_EVENT, requestRefresh);
    window.addEventListener(SOCKET_CONNECTED_EVENT, requestRefresh);
    return () => {
      window.removeEventListener(WORKFLOW_CHANGED_EVENT, onWorkflowChanged as EventListener);
      window.removeEventListener(WORKFLOW_REFRESH_EVENT, requestRefresh);
      window.removeEventListener(SOCKET_CONNECTED_EVENT, requestRefresh);
    };
  }, [aid, cid, refresh, scopeKey, setState]);

  return useMemo(() => ({ ...state, refresh }), [refresh, state]);
}

function eventToSnapshot(event: WorkflowRealtimeEvent): ActiveWorkflowSnapshot {
  return {
    run: event.run,
    phases: event.phases.map((phase) => ({
      ...phase,
      dependencyIds: [...phase.dependencyIds],
    })),
    currentPhase: event.currentPhase
      ? { ...event.currentPhase, dependencyIds: [...event.currentPhase.dependencyIds] }
      : null,
  };
}

type Revision = { workflowId: string | null; runVersion: number; updatedAt: number };

function revisionOfState(state: ActiveWorkflowLoadState): Revision {
  return {
    workflowId: state.snapshot?.run.id ?? state.lastWorkflowId,
    runVersion: state.lastRunVersion ?? -1,
    updatedAt: state.lastUpdatedAt ?? -1,
  };
}

function revisionOfEvent(event: WorkflowRealtimeEvent): Revision {
  return {
    workflowId: event.workflowId,
    runVersion: event.runVersion,
    updatedAt: Date.parse(event.updatedAt) || event.createdAt,
  };
}

function compareRevision(left: Revision, right: Revision): number {
  if (left.workflowId !== right.workflowId) {
    return left.updatedAt - right.updatedAt;
  }
  return left.runVersion - right.runVersion
    || left.updatedAt - right.updatedAt;
}

function compareEventToState(event: WorkflowRealtimeEvent, state: ActiveWorkflowLoadState): number {
  return compareRevision(revisionOfEvent(event), revisionOfState(state));
}

function compareSnapshotToState(snapshot: ActiveWorkflowSnapshot, state: ActiveWorkflowLoadState): number {
  return compareRevision({
    workflowId: snapshot.run.id,
    runVersion: snapshot.run.version ?? 0,
    updatedAt: Date.parse(snapshot.run.updatedAt) || 0,
  }, revisionOfState(state));
}

function revisionAdvanced(state: ActiveWorkflowLoadState, baseline: Revision): boolean {
  return compareRevision(revisionOfState(state), baseline) > 0;
}

function isWorkflowRealtimeEvent(value: unknown): value is WorkflowRealtimeEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<WorkflowRealtimeEvent>;
  return event.type === 'workflow:changed'
    && typeof event.workflowId === 'string'
    && typeof event.agentId === 'string'
    && typeof event.conversationId === 'string'
    && typeof event.runVersion === 'number'
    && typeof event.updatedAt === 'string'
    && Boolean(event.run)
    && Array.isArray(event.phases);
}
