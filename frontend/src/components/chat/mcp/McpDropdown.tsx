import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { McpServerItem } from './useMcpServers';
import McpListItem, { McpEmptyListItem } from './McpListItem';
import { useLocalize } from '../../../localization/useLocalize';

interface McpDropdownProps {

  servers: McpServerItem[];
  globallyEnabled: boolean;
  loading: boolean;
  busyKey?: string | null;
  error?: string | null;
  onGlobalEnabledChange: (enabled: boolean) => void;
  onServerEnabledChange: (
    installationId: string,
    enabled: boolean,
  ) => void;
}

export default function McpDropdown({
    servers,
  globallyEnabled,
  loading,
  busyKey,
  error,
  onGlobalEnabledChange,
  onServerEnabledChange,
}: McpDropdownProps) {
  const localize = useLocalize();
  const [query, setQuery] = useState('');

  const filteredServers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return servers;
    return servers.filter((server) => {
      const name = server.name?.toLowerCase() ?? '';
      const displayName = server.displayName?.toLowerCase() ?? '';
      const description = server.description?.toLowerCase() ?? '';
      return name.includes(keyword)
        || displayName.includes(keyword)
        || description.includes(keyword);
    });
  }, [query, servers]);

  return (
    <div className={`absolute bottom-[calc(100%+6px)] left-0 z-50 w-[196px] overflow-hidden rounded-[13px] border p-[7px] shadow-[7px_7px_21px_rgba(0,0,0,0.1)] ${
      'border-edge-control bg-surface-menu text-theme-primary-soft-alt   '
    }`}>
      <button
        type="button"
        onClick={() => onGlobalEnabledChange(!globallyEnabled)}
        disabled={busyKey === 'global'}
        className={`mb-[6px] flex h-[29px] w-full items-center rounded-[8px] px-[8px] text-left transition disabled:cursor-wait disabled:opacity-60 ${
          'bg-[#eeeeee] hover:bg-[#e6e6e6] dark:bg-[#242424] dark:hover:bg-[#1f1f1f]'
        }`}
        title={globallyEnabled ? localize('mcp.dropdown.disableGlobal') : localize('mcp.dropdown.enableGlobal')}
      >
        <span className="min-w-0 flex-1 text-[9px] font-medium">
          {localize('mcp.dropdown.globalToggle')}
        </span>
        <span className={`mr-[7px] text-[8px] font-medium ${
          globallyEnabled ? 'text-[#0c5cfb]' : 'text-[#777777] dark:text-[#888888]'
        }`}>
          {globallyEnabled ? localize('mcp.dropdown.enabled') : localize('mcp.dropdown.disabled')}
        </span>
        <span className={`relative h-[12px] w-[21px] shrink-0 rounded-full transition ${
          globallyEnabled ? 'bg-action-primary' : 'bg-[#cccccc] dark:bg-[#4a4a4a]'
        }`} aria-hidden="true">
          <span className={`absolute top-[2px] h-[8px] w-[8px] rounded-full bg-[#ffffff] transition ${
            globallyEnabled ? 'left-[11px]' : 'left-[2px]'
          }`} />
        </span>
      </button>

      <div className={`mb-[6px] flex h-[24px] items-center gap-[6px] rounded-[8px] px-[8px] transition ${
        'bg-[#f1f1f1] focus-within:bg-[#eeeeee] dark:bg-[#242424] dark:focus-within:bg-[#1f1f1f]'
      }`}>
        <Search className={`h-[9px] w-[9px] shrink-0 ${
          'text-[#8a8a8a] dark:text-[#9a9a9a]'
        }`} strokeWidth={2} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={localize('mcp.dropdown.searchPlaceholder')}
          className={`h-full min-w-0 flex-1 border-0 bg-transparent text-[8.5px] font-medium outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 ${
            'text-[#555555] placeholder:text-[#9a9a9a] dark:text-[#e8e8e8] dark:placeholder:text-[#777777]'
          }`}
        />
      </div>

      {error && (
        <div className="mb-[5px] rounded-[7px] bg-red-500/10 px-[8px] py-[5px] text-[8px] leading-[12px] text-red-500">
          {error}
        </div>
      )}

      {loading ? (
        <div className={`flex h-[29px] w-full items-center rounded-[7px] px-[8px] text-[9px] ${
          'text-[#888888] dark:text-[#9a9a9a]'
        }`}>
          {localize('common.loading')}
        </div>
      ) : (
        <div className="flex max-h-[210px] flex-col gap-[2px] overflow-y-auto">
          {filteredServers.length === 0 ? (
            <McpEmptyListItem

              emptyText={servers.length === 0 ? localize('mcp.dropdown.empty') : localize('mcp.dropdown.noMatch')}
            />
          ) : filteredServers.map((server) => (
            <McpListItem
              key={server.id}
              server={server}

              disabled={busyKey === `installation:${server.installationId}`}
              onToggle={(enabled) => {
                onServerEnabledChange(server.installationId, enabled);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
