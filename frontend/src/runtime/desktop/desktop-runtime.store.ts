import { initialDesktopRuntimeState } from './desktop-runtime.bootstrap';
import type { DesktopRuntimeState } from './desktop-runtime.types';

let snapshot = initialDesktopRuntimeState();
const listeners = new Set<(state: DesktopRuntimeState) => void>();

export function getDesktopRuntimeSnapshot(): DesktopRuntimeState {
  return snapshot;
}

export function setDesktopRuntimeSnapshot(next: DesktopRuntimeState): void {
  snapshot = next;
  for (const listener of listeners) listener(next);
}

export function subscribeDesktopRuntime(
  listener: (state: DesktopRuntimeState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
