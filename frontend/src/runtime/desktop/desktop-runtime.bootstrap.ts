                                                            
import type { DesktopRuntimeState } from './desktop-runtime.types';
import { EMPTY_DESKTOP_CAPABILITIES } from './desktop-runtime.types';

export type DesktopBootstrapSnapshot = {
  host: 'web' | 'desktop';
  bridge: 'none' | 'missing' | 'ready';
};

export function readDesktopBootstrapSnapshot(): DesktopBootstrapSnapshot {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { host: 'web', bridge: 'none' };
  }

  const declared = window.__SEEKMORE_DESKTOP_BOOTSTRAP__;
  if (declared) return declared;

  const runtime = document.documentElement.dataset.runtime;
  const bridge = document.documentElement.dataset.desktopBridge;
  return {
    host: runtime === 'desktop' ? 'desktop' : 'web',
    bridge:
      bridge === 'ready'
        ? 'ready'
        : bridge === 'missing'
          ? 'missing'
          : 'none',
  };
}

export function initialDesktopRuntimeState(): DesktopRuntimeState {
  const bootstrap = readDesktopBootstrapSnapshot();
  if (bootstrap.host === 'web') {
    return {
      phase: 'web',
      isDesktop: false,
      bridgeReady: false,
      environment: null,
      capabilities: EMPTY_DESKTOP_CAPABILITIES,
      error: null,
    };
  }

  return {
    phase: 'unknown',
    isDesktop: true,
    bridgeReady: false,
    environment: null,
    capabilities: EMPTY_DESKTOP_CAPABILITIES,
    error: null,
  };
}
