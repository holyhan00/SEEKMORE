import { localizeText } from '../../localization/localization';
import {
  connectMcp,
  getMcpOAuthStatus,
  initiateMcpOAuth,
  installMcp,
  reconnectMcp,
  installSkill,
  joinAgent,
} from './explore.api';
import type {
  ExploreMcpItem,
  ExploreResourceItem,
} from './explore.types';

async function openExternalUrl(url: string): Promise<void> {
  try {
    const result = await window.seekmoreDesktop?.web?.openExternal?.(url);
    if (result?.opened) return;
  } catch {
                                      
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function openMcpManagement(
  item: ExploreMcpItem,
  installationId: string,
): void {
  const action = item.actionState === 'SETUP'
    ? 'setup'
    : 'configure';

  window.dispatchEvent(new CustomEvent('mcp:manage', {
    detail: {
      installationId,
      action,
    },
  }));
}

async function authorizeMcp(installationId: string): Promise<void> {
  const started = await initiateMcpOAuth(installationId);
  await openExternalUrl(started.authorizationUrl);

  for (let attempt = 0; attempt < 300; attempt += 1) {
    await delay(1_000);
    const state = await getMcpOAuthStatus(installationId);
    if (state.status === 'authorized') return;
    if (state.status === 'revoked') {
      throw new Error(localizeText('explore.mcp.oauthRevoked'));
    }
  }

  throw new Error(localizeText('explore.mcp.oauthPending'));
}

export async function runExploreResourceAction(
  item: ExploreResourceItem,
): Promise<void> {
  if (item.resourceType === 'AGENT') {
    if (item.actionState !== 'ADDED') {
      await joinAgent(item);
    }
    return;
  }

  if (item.resourceType === 'SKILL') {
    if (item.actionState !== 'INSTALLED') {
      await installSkill(item.id);
    }
    return;
  }

  if (!item.installed || item.actionState === 'INSTALL') {
    await installMcp(item.id);
    return;
  }

  if (!item.installationId) return;

  if (item.actionState === 'AUTHORIZE') {
    await authorizeMcp(item.installationId);
    return;
  }

  if (
    item.actionState === 'CONFIGURE'
    || item.actionState === 'RECONFIGURE'
    || item.actionState === 'SETUP'
  ) {
    openMcpManagement(item, item.installationId);
    return;
  }

  if (item.actionState === 'CONNECT') {
    await connectMcp(item.installationId);
    return;
  }

  if (item.actionState === 'RECONNECT') {
    await reconnectMcp(item.installationId);
  }
}
