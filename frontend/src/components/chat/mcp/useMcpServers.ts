                                                    

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  api,
} from '../../../lib/api';

import {
  resolveMcpRequestError,
} from '../../../lib/mcp-request-error';

export type McpConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'failed';

export interface McpServerItem {
  id: string;
  installationId: string;
  serverId: string;
  stableKey?: string | null;
  name: string;
  displayName: string;
  description?: string;
  iconKey?: string | null;
  enabled: boolean;
  configurationState: string;
  connectionState: McpConnectionState;
  connectionStatus: McpConnectionState;
  connectionFailureCode?: string | null;
  connectionFailureMessage?: string | null;
  transport:
    | 'stdio'
    | 'streamable_http';
  toolCount: number;
  availability:
    | 'ready'
    | 'oauth'
    | 'credential'
    | 'local_setup';
  configurationHint: string;
  configurationHintPresentation?: { key: string; params?: Record<string, string> } | null;
  actionState: string;
  usable: boolean;
}

interface McpChatState {
  globallyEnabled: boolean;
  installations: McpServerItem[];
}

function unwrapState(
  value: unknown,
): McpChatState {
  const envelope =
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
      ? value as {
          data?: unknown;
          globallyEnabled?: unknown;
          installations?: unknown;
        }
      : null;

  const raw =
    envelope?.data &&
    typeof envelope.data === 'object'
      ? envelope.data as {
          globallyEnabled?: unknown;
          installations?: unknown;
        }
      : envelope;

  return {
    globallyEnabled:
      typeof raw?.globallyEnabled ===
      'boolean'
        ? raw.globallyEnabled
        : true,

    installations:
      Array.isArray(
        raw?.installations,
      )
        ? raw.installations as
          McpServerItem[]
        : [],
  };
}

export function useMcpServers() {
  const [
    servers,
    setServers,
  ] = useState<McpServerItem[]>([]);

  const [
    globallyEnabled,
    setGloballyEnabledState,
  ] = useState(true);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    busyKey,
    setBusyKey,
  ] = useState<string | null>(null);

  const [
    error,
    setError,
  ] = useState<string | null>(null);

  const refresh = useCallback(
    async (
      silent = false,
    ) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const response =
          await api.get('/mcp/chat');

        const state =
          unwrapState(response.data);

        setGloballyEnabledState(
          state.globallyEnabled,
        );

        setServers(
          state.installations,
        );

        setError(null);

        return state;
      } catch (cause) {
        setError(
          resolveMcpRequestError(
            cause,
            'errors.mcp.statusLoadFailed',
          ),
        );

        return null;
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();

    const handleFocus = () => {
      void refresh(true);
    };

    const handleStateChanged = () => {
      void refresh(true);
    };

    window.addEventListener(
      'focus',
      handleFocus,
    );

    window.addEventListener(
      'mcp:state-changed',
      handleStateChanged,
    );

    return () => {
      window.removeEventListener(
        'focus',
        handleFocus,
      );

      window.removeEventListener(
        'mcp:state-changed',
        handleStateChanged,
      );
    };
  }, [refresh]);

  const setGloballyEnabled =
    useCallback(
      async (
        enabled: boolean,
      ) => {
        const previous =
          globallyEnabled;

        setBusyKey('global');
        setError(null);

        setGloballyEnabledState(
          enabled,
        );

        setServers((current) =>
          current.map((item) => ({
            ...item,

            usable:
              enabled &&
              item.enabled &&
              item.configurationState ===
                'ready' &&
              item.connectionState ===
                'connected' &&
              item.toolCount > 0,
          })),
        );

        try {
          await api.patch(
            '/mcp/preferences/global-enabled',
            {
              enabled,
            },
          );

          window.dispatchEvent(
            new CustomEvent(
              'mcp:state-changed',
            ),
          );
        } catch (cause) {
          setGloballyEnabledState(
            previous,
          );

          setServers((current) =>
            current.map((item) => ({
              ...item,

              usable:
                previous &&
                item.enabled &&
                item.configurationState ===
                  'ready' &&
                item.connectionState ===
                  'connected' &&
                item.toolCount > 0,
            })),
          );

          setError(
            resolveMcpRequestError(
              cause,
              'errors.mcp.globalToggleFailed',
            ),
          );
        } finally {
          setBusyKey(null);
        }
      },
      [
        globallyEnabled,
      ],
    );

  const setServerEnabled =
    useCallback(
      async (
        installationId: string,
        enabled: boolean,
      ) => {
        const previousItem =
          servers.find(
            (item) =>
              item.installationId ===
              installationId,
          );

        if (!previousItem) {
          return;
        }

        setBusyKey(
          `installation:${installationId}`,
        );

        setError(null);

        setServers((current) =>
          current.map((item) =>
            item.installationId ===
            installationId
              ? {
                  ...item,
                  enabled,

                  usable:
                    globallyEnabled &&
                    enabled &&
                    item.configurationState ===
                      'ready' &&
                    item.connectionState ===
                      'connected' &&
                    item.toolCount > 0,
                }
              : item,
          ),
        );

        try {
          await api.patch(
            `/mcp/installations/${installationId}`,
            {
              enabled,
            },
          );

          window.dispatchEvent(
            new CustomEvent(
              'mcp:state-changed',
            ),
          );
        } catch (cause) {
          setServers((current) =>
            current.map((item) =>
              item.installationId ===
              installationId
                ? previousItem
                : item,
            ),
          );

          setError(
            resolveMcpRequestError(
              cause,
              'errors.mcp.toggleFailed',
            ),
          );
        } finally {
          setBusyKey(null);
        }
      },
      [
        globallyEnabled,
        servers,
      ],
    );

  return {
    servers,
    globallyEnabled,
    loading,
    busyKey,
    error,
    refresh,
    setGloballyEnabled,
    setServerEnabled,
  };
}