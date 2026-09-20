export type McpPresentationAvailability =
  | 'ready'
  | 'oauth'
  | 'credential'
  | 'local_setup';

export type McpInstallationActionState =
  | 'INSTALL'
  | 'DISABLED'
  | 'AUTHORIZE'
  | 'CONFIGURE'
  | 'RECONFIGURE'
  | 'SETUP'
  | 'CONNECT'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECT';

export interface McpConfigurationPresentation {
  key: string;
  params: Record<string, string>;
  fallback: string;
}

export function resolveMcpInstallationActionState({
  installed,
  enabled,
  configurationState,
  connectionStatus,
  availability,
}: {
  installed: boolean;
  enabled: boolean;
  configurationState?: string | null;
  connectionStatus?: string | null;
  availability: McpPresentationAvailability;
}): McpInstallationActionState {
  if (!installed) return 'INSTALL';
  if (!enabled) return 'DISABLED';

  if (configurationState !== 'ready') {
    if (availability === 'oauth') return 'AUTHORIZE';
    if (availability === 'local_setup') return 'SETUP';
    return configurationState === 'invalid'
      ? 'RECONFIGURE'
      : 'CONFIGURE';
  }

  if (connectionStatus === 'connected') return 'CONNECTED';
  if (connectionStatus === 'connecting') return 'CONNECTING';
  if (connectionStatus === 'failed') return 'RECONNECT';
  return 'CONNECT';
}

export function describeMcpConfiguration(
  availability: McpPresentationAvailability,
  displayName: string,
): McpConfigurationPresentation {
  switch (availability) {
    case 'oauth':
      return {
        key: 'mcp.configuration.oauth',
        params: { displayName },
        fallback: `Sign in to ${displayName} and complete authorization.`,
      };
    case 'credential':
      return {
        key: 'mcp.configuration.credential',
        params: { displayName },
        fallback: `Configure access credentials for ${displayName}.`,
      };
    case 'local_setup':
      return {
        key: 'mcp.configuration.localSetup',
        params: { displayName },
        fallback: `Complete the local or self-hosted setup for ${displayName} first.`,
      };
    default:
      return {
        key: 'mcp.configuration.ready',
        params: {},
        fallback: 'No additional configuration is required. Connect after installation.',
      };
  }
}
