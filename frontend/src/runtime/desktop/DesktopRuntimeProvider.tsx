import { localizeText } from '../../localization/localization';
import {
  createContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { initialDesktopRuntimeState } from './desktop-runtime.bootstrap';
import {
  EMPTY_DESKTOP_CAPABILITIES,
  type DesktopRuntimeState,
} from './desktop-runtime.types';
import { setDesktopRuntimeSnapshot } from './desktop-runtime.store';

export const DesktopRuntimeContext = createContext<DesktopRuntimeState>(
  initialDesktopRuntimeState(),
);

const BRIDGE_WAIT_ATTEMPTS = 20;
const BRIDGE_WAIT_MS = 100;

export function DesktopRuntimeProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<DesktopRuntimeState>(
    initialDesktopRuntimeState,
  );

  useEffect(() => {
    let disposed = false;

    const publish = (next: DesktopRuntimeState): void => {
      if (disposed) return;
      setState(next);
      setDesktopRuntimeSnapshot(next);
      document.documentElement.dataset.runtime = next.isDesktop
        ? 'desktop'
        : 'web';
      document.documentElement.dataset.desktopBridge = next.bridgeReady
        ? 'ready'
        : next.phase === 'desktop-bridge-error'
          ? 'error'
          : next.isDesktop
            ? 'loading'
            : 'none';
    };

    const probe = async (): Promise<void> => {
      const initial = initialDesktopRuntimeState();
      if (!initial.isDesktop) {
        publish(initial);
        return;
      }

      let bridge = window.seekmoreDesktop;
      for (
        let attempt = 0;
        !bridge && attempt < BRIDGE_WAIT_ATTEMPTS;
        attempt += 1
      ) {
        await delay(BRIDGE_WAIT_MS);
        if (disposed) return;
        bridge = window.seekmoreDesktop;
      }

      if (!bridge) {
        publish({
          phase: 'desktop-bridge-error',
          isDesktop: true,
          bridgeReady: false,
          environment: null,
          capabilities: EMPTY_DESKTOP_CAPABILITIES,
          error: {
            code: 'BRIDGE_MISSING',
            message: localizeText('app.desktopBridgeFailed'),
          },
        });
        return;
      }

      try {
        const [ping, capabilities] = await Promise.all([
          bridge.ping(),
          bridge.getCapabilities(),
        ]);
        const environment = bridge.getEnvironment();
        if (!ping?.ok || environment?.isDesktop !== true) {
          throw new Error('Desktop bridge handshake returned an invalid response.');
        }

        publish({
          phase: 'desktop-ready',
          isDesktop: true,
          bridgeReady: true,
          environment,
          capabilities: {
            workspace: capabilities.workspace === true,
            clipboardWrite: capabilities.clipboardWrite === true,
            reminderRing: capabilities.reminderRing === true,
            webRuntime: capabilities.webRuntime === true,
          },
          error: null,
        });
      } catch (error) {
        console.error('[DesktopRuntime] Bridge handshake failed', error);
        publish({
          phase: 'desktop-bridge-error',
          isDesktop: true,
          bridgeReady: false,
          environment: null,
          capabilities: EMPTY_DESKTOP_CAPABILITIES,
          error: {
            code: 'BRIDGE_HANDSHAKE_FAILED',
            message: localizeText('app.desktopBridgeFailed'),
          },
        });
      }
    };

    void probe();
    return () => {
      disposed = true;
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return (
    <DesktopRuntimeContext.Provider value={value}>
      {children}
    </DesktopRuntimeContext.Provider>
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
