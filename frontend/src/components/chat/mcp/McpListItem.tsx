import { resolveAssetUrl } from '../../../utils/asset-url';
import { useAppearance } from '../../../theme/useAppearance';
import { useLocalize } from '../../../localization/useLocalize';
                                                   

import React from 'react';

import type {
  McpServerItem,
} from './useMcpServers';

interface McpListItemProps {
  server: McpServerItem;

  disabled?: boolean;
  onToggle: (
    enabled: boolean,
  ) => void;
}

interface McpEmptyListItemProps {

  emptyText?: string;
}

function statusKey(server: McpServerItem): string {
  if (!server.enabled) return 'mcp.status.disabled';
  if (server.connectionState === 'connecting') return 'mcp.status.connecting';
  if (server.connectionState === 'connected') return 'mcp.status.connected';
  if (server.connectionState === 'failed') return 'mcp.status.failed';
  return 'mcp.status.disconnected';
}

const McpListItem:
React.FC<McpListItemProps> = ({
  server,
    disabled = false,
  onToggle,
}) => {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();
  const active = server.enabled;

  const backgroundClass =
    'bg-transparent text-theme-primary-soft-alt dark:bg-transparent ';

  const hoverClass =
    'hover:bg-surface-list-hover ';

  const state = localize(statusKey(server));

  return (
    <button
      type="button"
      onClick={() =>
        onToggle(!server.enabled)
      }
      disabled={disabled}
      aria-pressed={server.enabled}
      className={`
        flex h-[29px] w-full
        cursor-pointer
        items-center gap-[8px]
        rounded-[7px]
        px-[8px]
        text-left
        transition-colors
        disabled:cursor-wait
        ${backgroundClass}
        ${hoverClass}
      `}
      title={
        `${server.displayName || server.name} · ${state}`
      }
    >
      <span
        className="
          flex h-[13px] w-[13px]
          shrink-0
          items-center justify-center
        "
      >
        <img
          src={
            active
              ? resolveAssetUrl('/icons/blue/mcpblue.svg')
              : isDarkTheme
                ? resolveAssetUrl('/icons/white/mcp1.svg')
                : resolveAssetUrl('/icons/mcp.svg')
          }
          alt=""
          className="h-[11px] w-[11px]"
          draggable={false}
        />
      </span>

      <div
        className="
          min-w-0 flex-1
          truncate
          text-[10px]
          font-medium
          leading-[14px]
        "
      >
        <span
          style={{
            userSelect: 'none',
          }}
        >
          {server.displayName ||
            server.name}
        </span>
      </div>

      <span
        className={`
          shrink-0
          text-[7.5px]
          font-medium
          ${
            'text-theme-muted-solid '
          }
        `}
      >
        {state}
      </span>
    </button>
  );
};

export function McpEmptyListItem({
    emptyText,
}: McpEmptyListItemProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const localize = useLocalize();

  return (
    <div
      className={`
        flex h-[29px] w-full
        items-center gap-[8px]
        rounded-[7px]
        px-[8px]
        ${
          'bg-transparent dark:bg-transparent'
        }
      `}
    >
      <span
        className="
          flex h-[13px] w-[13px]
          shrink-0
          items-center justify-center
        "
      >
        <img
          src={
            isDarkTheme
              ? resolveAssetUrl('/icons/white/mcp1.svg')
              : resolveAssetUrl('/icons/mcp.svg')
          }
          alt=""
          className="
            h-[11px] w-[11px]
            opacity-60
          "
          draggable={false}
        />
      </span>

      <div
        className={`
          min-w-0 flex-1
          truncate
          text-[9px]
          font-medium
          leading-[14px]
          ${
            'text-[#888888] dark:text-[#9a9a9a]'
          }
        `}
      >
        {emptyText ?? localize('mcp.dropdown.empty')}
      </div>
    </div>
  );
}

export default McpListItem;