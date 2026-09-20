import { useEffect, useMemo, useState } from 'react';
import { fetchConversationAutomations } from './automation.api';
import type { AutomationSnapshot } from './automation.types';

type ConversationAutomationState = {
  items: AutomationSnapshot[];
  loaded: boolean;
  loading: boolean;
  anchorListeners: Map<string, Set<() => void>>;
};

const states = new Map<string, ConversationAutomationState>();
let realtimeBound = false;

function stateFor(conversationId: string): ConversationAutomationState {
  let state = states.get(conversationId);
  if (!state) {
    state = { items: [], loaded: false, loading: false, anchorListeners: new Map() };
    states.set(conversationId, state);
  }
  bindRealtime();
  return state;
}

function emitAnchor(conversationId: string, anchorMessageId: string | null | undefined): void {
  if (!anchorMessageId) return;
  const listeners = states.get(conversationId)?.anchorListeners.get(anchorMessageId);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

function replaceItem(item: AutomationSnapshot): void {
  const conversationId = String(item?.conversationId ?? '').trim();
  if (!conversationId) return;
  const state = stateFor(conversationId);
  const previous = state.items.find((candidate) => candidate.id === item.id);
  const index = state.items.findIndex((candidate) => candidate.id === item.id);
  state.items = index >= 0
    ? state.items.map((candidate, position) => position === index ? item : candidate)
    : [item, ...state.items];
  state.loaded = true;
  emitAnchor(conversationId, previous?.anchorMessageId);
  if (previous?.anchorMessageId !== item.anchorMessageId) emitAnchor(conversationId, item.anchorMessageId);
}

async function load(conversationId: string, force = false): Promise<void> {
  const state = stateFor(conversationId);
  if (state.loading || (!force && state.loaded)) return;
  state.loading = true;
  try {
    const previousAnchors = new Set(state.items.map((item) => item.anchorMessageId).filter(Boolean) as string[]);
    state.items = await fetchConversationAutomations(conversationId);
    state.loaded = true;
    const anchors = new Set([
      ...previousAnchors,
      ...state.items.map((item) => item.anchorMessageId).filter(Boolean) as string[],
    ]);
    for (const anchor of anchors) emitAnchor(conversationId, anchor);
  } catch (error) {
    console.error('[Automation] load failed', error);
  } finally {
    state.loading = false;
  }
}

function bindRealtime(): void {
  if (realtimeBound || typeof window === 'undefined') return;
  realtimeBound = true;
  window.addEventListener('chat:automation:changed', ((event: Event) => {
    const detail = (event as CustomEvent<{ automation?: AutomationSnapshot }>).detail;
    if (detail?.automation?.id) replaceItem(detail.automation);
  }) as EventListener);
}

export function applyAutomationSnapshot(item: AutomationSnapshot): void {
  replaceItem(item);
}

export function clearConversationAutomations(conversationId: string): void {
  states.delete(conversationId);
}

export function useAnchoredAutomations(conversationId: string, anchorMessageId: string): AutomationSnapshot[] {
  const [, rerender] = useState(0);
  const state = stateFor(conversationId);

  useEffect(() => {
    if (!conversationId || !anchorMessageId) return;
    const current = stateFor(conversationId);
    const listeners = current.anchorListeners.get(anchorMessageId) ?? new Set<() => void>();
    const listener = () => rerender((value) => value + 1);
    listeners.add(listener);
    current.anchorListeners.set(anchorMessageId, listeners);
    void load(conversationId);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) current.anchorListeners.delete(anchorMessageId);
    };
  }, [conversationId, anchorMessageId]);

  return useMemo(
    () => state.items
      .filter((item) => item.anchorMessageId === anchorMessageId)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
    [state.items, anchorMessageId],
  );
}
