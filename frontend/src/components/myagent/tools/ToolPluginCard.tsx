                                                           
import { useLocalize } from '../../../localization/useLocalize';
import ToggleSwitch from '../../ui/ToggleSwitch';
import type { ToolRegistryItem } from './api/tool-registry.types';

function normalizeLabel(
  value?: string,
): string {
  if (!value) {
    return '';
  }

  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
}

interface ToolPluginCardProps {
  tool: ToolRegistryItem;

  updating?: boolean;
  onEnabledChange?: (
    tool: ToolRegistryItem,
    enabled: boolean,
  ) => void;
}

export default function ToolPluginCard({
  tool,
    updating = false,
  onEnabledChange,
}: ToolPluginCardProps) {
  const localize = useLocalize();
  const displayName = localize(
    `tools.${tool.name}.name`,
    { defaultValue: tool.name },
  );

  const enabled =
    tool.enabled !== false;

  const systemEnabled =
    tool.systemEnabled !== false;

  return (
    <article
      className={`
        group
        box-border
        flex
        h-[120px]
        w-full
        min-w-[120px]
        flex-col
        overflow-hidden
        rounded-[12px]
        p-[10px]
        select-none
        transition-all
        duration-200
        hover:-translate-y-[2px]
        hover:shadow-[0_18px_40px_rgba(12,92,251,0.18)]
        active:translate-y-0
        ${
          'bg-surface-panel '
        }
      `}
    >
      <div className="flex items-start justify-end">
        <ToggleSwitch
          checked={enabled}

          loading={updating}
          disabled={
            !systemEnabled
            || !onEnabledChange
          }
          ariaLabel={
            enabled
              ? localize('tools.disable', { name: displayName })
              : localize('tools.enable', { name: displayName })
          }
          onChange={(nextEnabled) => {
            onEnabledChange?.(
              tool,
              nextEnabled,
            );
          }}
        />
      </div>

      <div className="mt-[10px] min-w-0">
        <h3
          className={`
            truncate
            text-[11px]
            tracking-[-0.01em]
            ${
              'text-theme-primary-alt '
            }
          `}
          title={displayName}
        >
          {displayName}
        </h3>

        <p
          className={`
            mt-[3px]
            truncate
            text-[9px]
            leading-[16px]
            ${
              'text-theme-balanced-50 '
            }
          `}
        >
          v{tool.version || '1.0.0'} ·{' '}
          {normalizeLabel(
            tool.sideEffectClass,
          )}
        </p>
      </div>

      <div
        className="
          mt-auto
          flex
          min-w-0
          flex-wrap
          gap-[5px]
          overflow-hidden
          pt-[10px]
        "
      >
        {(tool.tags || [])
          .slice(0, 3)
          .map((tag) => (
            <span
              key={tag}
              className={`
                max-w-full
                truncate
                rounded-[7px]
                px-[8px]
                py-[4px]
                text-[9px]
                transition-colors
                ${
                  'bg-[#eeeeee] text-[#777777] dark:bg-[#242425] dark:text-[#b5b5b5]'
                }
              `}
              title={tag}
            >
              {tag}
            </span>
          ))}

        {tool.requiresApproval && (
          <span
            className={`
              shrink-0
              rounded-[7px]
              px-[8px]
              py-[4px]
              text-[9px]
              transition-colors
              ${
                'bg-[#fff5df] text-[#9a6810] dark:bg-[#3a2d15] dark:text-[#e8bc67]'
              }
            `}
          >
            {localize('tools.requiresConfirmation')}
          </span>
        )}
      </div>
    </article>
  );
}