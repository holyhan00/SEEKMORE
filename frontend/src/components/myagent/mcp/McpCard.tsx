                                                  
import type { MouseEvent } from 'react';
import type { McpInstallationItem } from './mcp.types';
import { useLocalize } from '../../../localization/useLocalize';
import { useSystemResourcePresentation } from '../../../localization/useSystemResourcePresentation';
interface McpCardProps {
  item: McpInstallationItem;

  selected: boolean;
  busyKey?: string | null;
  authorizing: boolean;
  onClick: () => void;
  onEnable: () => void;
  onAuthorize: () => void;
  onConfigure: () => void;
  onConnect: () => void;
  onDisable: () => void;
  onRefreshTools: () => void;
  onUpdateConfiguration: () => void;
  onReauthorize: () => void;
  onRevokeAuthorization: () => void;
  onUninstall: () => void;
}
interface McpStatusMeta {
  label: string;
  className: string;
}
function getMcpStatusMeta(
  item: McpInstallationItem,
  localize: (key: string, values?: Record<string, unknown>) => string,
): McpStatusMeta {
  if (!item.enabled) {
    return { label: localize('mcp.status.disabled'), className: 'bg-[#e5e7eb] text-theme-skill-muted dark:bg-[#1e1e1e] ' };
  }
  if (item.actionState === 'AUTHORIZE') {
    return { label: localize('mcp.status.authorizationRequired'), className: 'bg-amber-500/[0.12] text-amber-700 dark:bg-amber-500/[0.15] dark:text-amber-300' };
  }
  if (item.actionState === 'SETUP') {
    return { label: localize('mcp.status.setupRequired'), className: 'bg-amber-500/[0.12] text-amber-700 dark:bg-amber-500/[0.15] dark:text-amber-300' };
  }
  if (item.actionState === 'CONFIGURE' || item.actionState === 'RECONFIGURE') {
    return { label: localize('mcp.status.configurationRequired'), className: 'bg-amber-500/[0.12] text-amber-700 dark:bg-amber-500/[0.15] dark:text-amber-300' };
  }
  if (item.connectionStatus === 'connected') {
    return { label: localize('mcp.status.connected'), className: 'bg-action-primary text-[#ffffff]' };
  }
  if (item.connectionStatus === 'connecting') {
    return { label: localize('mcp.status.connecting'), className: 'bg-blue-500/[0.10] text-blue-700 dark:bg-blue-500/[0.15] dark:text-blue-300' };
  }
  if (item.connectionStatus === 'failed') {
    return { label: localize('mcp.status.failed'), className: 'bg-red-500/[0.10] text-red-600 dark:bg-red-500/[0.14] dark:text-red-300' };
  }
  return { label: localize('mcp.status.disconnected'), className: 'bg-[#e5e7eb] text-theme-skill-muted dark:bg-[#1e1e1e] ' };
}
function stopAndRun(
  event: MouseEvent<HTMLButtonElement>,
  action: () => void,
): void {
  event.stopPropagation();
  action();
}
export default function McpCard({
  item,
    selected,
  busyKey = null,
  authorizing,
  onClick,
  onEnable,
  onAuthorize,
  onConfigure,
  onConnect,
  onDisable,
  onRefreshTools,
  onUpdateConfiguration,
  onReauthorize,
  onRevokeAuthorization,
  onUninstall,
}: McpCardProps) {
  const localize = useLocalize();
  const systemPresentation = useSystemResourcePresentation();
  const displayedDescription = systemPresentation.mcpText({ source: item.source, stableKey: item.stableKey, field: 'description', fallback: item.description });
  const statusMeta = getMcpStatusMeta(item, localize);
  const primaryBtn = `
    inline-flex h-[30px] shrink-0 !select-none items-center justify-center [&>*]:!select-none
    whitespace-nowrap rounded-[10px] border-0 bg-action-primary
    px-[14px] text-[9px] font-medium text-[#ffffff] outline-none
    transition-colors hover:bg-action-primary-hover
    disabled:cursor-not-allowed disabled:opacity-45
  `;
  const secondaryBtn = `
    inline-flex h-[28px] shrink-0 !select-none items-center justify-center [&>*]:!select-none
    whitespace-nowrap rounded-[8px] border-0 px-[10px] text-[9px] font-medium
    outline-none transition-colors
    disabled:cursor-not-allowed disabled:opacity-35
    ${
      'bg-surface-card text-theme-subtle hover:bg-surface-card-hover hover:text-[#000000]/70    dark:hover:text-[#ffffff]/70'
    }
  `;
  const operationButton = (() => {
    if (!item.enabled) return null;
    if (item.actionState === 'AUTHORIZE') {
      return (
        <button
          type="button"
          disabled={authorizing}
          className={primaryBtn}
          onClick={(e) => stopAndRun(e, onAuthorize)}
        >
          {authorizing ? localize('mcp.action.waitingAuthorization') : localize('mcp.action.authorize')}
        </button>
      );
    }
    if (
      item.actionState === 'CONFIGURE' ||
      item.actionState === 'RECONFIGURE' ||
      item.actionState === 'SETUP'
    ) {
      return (
        <button
          type="button"
          className={primaryBtn}
          onClick={(e) => stopAndRun(e, onConfigure)}
        >
          {item.actionState === 'SETUP'
            ? localize('mcp.action.setup')
            : item.actionState === 'RECONFIGURE'
              ? localize('mcp.action.reconfigure')
              : localize('mcp.action.configure')}
        </button>
      );
    }
    if (item.actionState !== 'CONNECTED') {
      return (
        <button
          type="button"
          disabled={
            item.actionState === 'CONNECTING' ||
            busyKey === `connect:${item.id}`
          }
          className={primaryBtn}
          onClick={(e) => stopAndRun(e, onConnect)}
        >
          {item.actionState === 'CONNECTING' ||
          busyKey === `connect:${item.id}`
            ? localize('mcp.action.connecting')
            : item.actionState === 'RECONNECT'
              ? localize('mcp.action.reconnect')
              : localize('mcp.action.connect')}
        </button>
      );
    }
    if (
      item.authKind !== 'none' &&
      item.authKind !== 'oauth2' &&
      item.configurationState === 'ready'
    ) {
      return (
        <button
          type="button"
          className={secondaryBtn}
          onClick={(e) => stopAndRun(e, onUpdateConfiguration)}
        >
          {localize('mcp.action.configure')}
        </button>
      );
    }
    if (
      item.authKind === 'oauth2' &&
      item.oauthStatus === 'authorized'
    ) {
      return (
        <button
          type="button"
          disabled={authorizing}
          className={secondaryBtn}
          onClick={(e) => stopAndRun(e, onReauthorize)}
        >
          {authorizing ? localize('mcp.action.waitingAuthorization') : localize('mcp.action.reauthorize')}
        </button>
      );
    }
    return null;
  })();
  return (
    <article
      onClick={onClick}
      className={`
        group relative box-border flex w-full min-w-[180px] cursor-pointer !select-none flex-col [&>*]:!select-none
        rounded-[10px] p-[12px] text-left outline-none transition-all duration-200
        hover:-translate-y-[2px] hover:shadow-[0_18px_40px_rgba(12,92,251,0.18)]
        active:translate-y-0
        ${selected ? 'ring-1 ring-[#0c5cfb]' : ''}
        ${
          'border-[#000000]/[0.055] bg-surface-control-alt hover:border-[#000000]/[0.10] dark:border-[#ffffff]/[0.06]  dark:hover:border-[#ffffff]/[0.11] dark:hover:bg-[#272728]'
        }
      `}
    >
      {        }
      <span
        className={`
          absolute right-[10px] top-[10px]
          inline-flex h-[18px] shrink-0 !select-none items-center justify-center [&>*]:!select-none
          whitespace-nowrap rounded-[11px] px-[6px] text-[8px] font-medium leading-none
          ${statusMeta.className}
        `}
      >
        {statusMeta.label}
      </span>
      {            }
      <div
        className={`
          min-w-0 truncate pr-[60px] text-[16px] font-semibold leading-[22px]
          ${'text-[#191919] dark:text-[#ffffff]'}
        `}
        title={item.displayName}
      >
        {item.displayName}
      </div>
      {            }
      <div
        className={`
          min-w-0 mt-[8px] line-clamp-2 text-[10px] leading-[16px]
          ${'text-[#000000]/45 dark:text-[#ffffff]/38'}
        `}
        title={displayedDescription || localize('common.noDescription')}
      >
        {displayedDescription || localize('common.noDescription')}
      </div>
      {              }
      <div className="mt-auto flex items-center justify-between gap-[8px] pt-[12px]">
        <div className="flex-1">{operationButton}</div>
        <div className="flex items-center gap-[6px] opacity-0 transition-opacity group-hover:opacity-100">
          {item.enabled && (
            <>
              <button
                type="button"
                disabled={
                  busyKey === `refresh:${item.id}` ||
                  item.connectionStatus !== 'connected'
                }
                className={secondaryBtn}
                onClick={(e) => stopAndRun(e, onRefreshTools)}
              >
                {busyKey === `refresh:${item.id}` ? localize('mcp.action.refreshing') : localize('mcp.action.refresh')}
              </button>
              {item.authKind === 'oauth2' &&
                item.oauthStatus === 'authorized' && (
                  <button
                    type="button"
                    className={secondaryBtn}
                    onClick={(e) =>
                      stopAndRun(e, onRevokeAuthorization)
                    }
                  >
                    {localize('mcp.action.revoke')}
                  </button>
                )}
            </>
          )}
          <button
            type="button"
            disabled={busyKey === `uninstall:${item.id}`}
            className={`${secondaryBtn} !text-red-500`}
            onClick={(e) => stopAndRun(e, onUninstall)}
          >
            {localize('mcp.action.uninstall')}
          </button>
          <button
            type="button"
            disabled={
              busyKey === `enable:${item.id}` ||
              busyKey === `disable:${item.id}`
            }
            className={item.enabled ? secondaryBtn : primaryBtn}
            onClick={(e) =>
              stopAndRun(e, item.enabled ? onDisable : onEnable)
            }
          >
            {busyKey === `enable:${item.id}` ||
            busyKey === `disable:${item.id}`
              ? '…'
              : item.enabled
                ? localize('mcp.action.disable')
                : localize('mcp.action.enable')}
          </button>
        </div>
      </div>
    </article>
  );
}