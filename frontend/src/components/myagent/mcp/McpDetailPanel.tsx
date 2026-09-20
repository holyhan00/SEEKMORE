                                                         
import { useLocalize } from '../../../localization/useLocalize';

import type {
  McpDefinitionDetail,
  McpInstallationItem,
  McpToolItem,
} from './mcp.types';

interface McpDetailPanelProps {

  selectedInstallation:
    | McpInstallationItem
    | null;
  tools: McpToolItem[];
  definitions: McpDefinitionDetail[];
  onEditDefinition: (
    definition:
      McpDefinitionDetail,
  ) => void;
}

export default function McpDetailPanel({
    selectedInstallation,
  tools,
  definitions,
  onEditDefinition,
}: McpDetailPanelProps) {
  const localize = useLocalize();

  const cardClass = `
    rounded-[10px]
    ${
      'bg-surface-control-alt '
    }
  `;

  const subtleButton = `
    box-border
    inline-flex
    h-[28px]
    shrink-0
    select-none
    items-center
    justify-center
    whitespace-nowrap
    rounded-[8px]
    border-0
    px-[10px]
    text-[9px]
    font-medium
    outline-none
    transition-colors
    ${
      'bg-surface-card text-theme-subtle hover:bg-surface-card-hover hover:text-[#000000]/70    dark:hover:text-[#ffffff]/70'
    }
  `;

  const editableDefinition =
    selectedInstallation?.source ===
    'USER'
      ? definitions.find(
          (item) =>
            item.id ===
            selectedInstallation.serverId,
        ) ?? null
      : null;

  return (
    <section
      className={`
        ${cardClass}
        flex
        min-h-0
        flex-1
        select-none
        flex-col
        overflow-hidden
        px-[12px]
        pb-[12px]
      `}
    >
      {!selectedInstallation ? (
        <div
          className={`
            flex
            min-h-[330px]
            items-center
            justify-center
            text-[11px]
            ${
              'text-theme-faint '
            }
          `}
        >
          {localize(
            'mcp.detail.selectInstallation',
          )}
        </div>
      ) : (
        <div
          key={
            selectedInstallation.id
          }
          className="
            flex
            h-full
            min-h-0
            flex-col
            overflow-hidden
          "
        >
          {              }
          <div
            className="
              flex
              flex-none
              items-start
              justify-between
              gap-[10px]
              pt-[10px]
            "
          >
            <div
              className="
                min-w-0
                flex-1
              "
            >
              <h2
                className={`
                  m-0
                  truncate
                  text-[16px]
                  font-semibold
                  leading-[22px]
                  tracking-[-0.025em]
                  ${
                    'text-[#191919] dark:text-[#ffffff]'
                  }
                `}
                title={
                  selectedInstallation.displayName
                }
              >
                {
                  selectedInstallation.displayName
                }
              </h2>

              <p
                className={`
                  mt-[10px]
                  max-w-full
                  text-[10px]
                  leading-[16px]
                  ${
                    'text-[#000000]/45 dark:text-[#ffffff]/38'
                  }
                `}
              >
                {localize(
                  'mcp.detail.toolCount',
                  {
                    count:
                      selectedInstallation.toolCount,
                  },
                )}{' '}
                ·{' '}
                {selectedInstallation.transport ===
                'stdio'
                  ? 'Desktop stdio'
                  : 'Remote HTTP'}
                {selectedInstallation.protocolVersion
                  ? ` · MCP ${selectedInstallation.protocolVersion}`
                  : ''}
              </p>
            </div>

            {editableDefinition && (
              <button
                type="button"
                className={
                  subtleButton
                }
                onClick={() =>
                  onEditDefinition(
                    editableDefinition,
                  )
                }
              >
                {localize(
                  'mcp.detail.editDefinition',
                )}
              </button>
            )}
          </div>

          {                  }
          <div
            className={`
              mt-[5px]
              flex-none
              text-[11px]
              font-medium
              leading-[16px]
              ${
                'text-[#000000]/75 dark:text-[#ffffff]/75'
              }
            `}
          >
            {localize(
              'mcp.detail.availableTools',
            )}
          </div>

          <p
            className={`
              mt-[4px]
              flex-none
              text-[9px]
              leading-[16px]
              ${
                'text-theme-faint '
              }
            `}
          >
            {localize(
              'mcp.detail.toolsHint',
            )}
          </p>

          {                }
          <div
            className="
              mt-[5px]
              flex
              min-h-0
              flex-1
              flex-col
              gap-[6px]
              overflow-y-auto
              [&::-webkit-scrollbar]:hidden
              [scrollbar-width:none]
            "
          >
            {tools.length === 0 ? (
              <div
                className={`
                  py-[10px]
                  text-center
                  text-[10px]
                  ${
                    'text-theme-dim '
                  }
                `}
              >
                {localize(
                  'mcp.detail.noTools',
                )}
              </div>
            ) : (
              tools.map(
                (tool) => (
                  <div
                    key={tool.id}
                    className={`
                      flex
                      items-start
                      gap-[10px]
                      rounded-[8px]
                      p-[10px]
                      ${
                        'bg-surface-card '
                      }
                    `}
                  >
                    <span
                      className="
                        mt-[6px]
                        h-[5px]
                        w-[5px]
                        shrink-0
                        rounded-full
                        bg-action-primary
                      "
                    />

                    <span className="min-w-0">
                      <span
                        className={`
                          block
                          truncate
                          text-[10px]
                          font-medium
                          leading-[16px]
                          ${
                            'text-[#000000]/75 dark:text-[#ffffff]/75'
                          }
                        `}
                        title={
                          tool.title ||
                          tool.toolName
                        }
                      >
                        {tool.title ||
                          tool.toolName}
                      </span>

                      <span
                        className={`
                          mt-[2px]
                          block
                          text-[8px]
                          leading-[14px]
                          ${
                            'text-theme-faint '
                          }
                        `}
                      >
                        {tool.description ||
                          localize(
                            'common.noDescription',
                          )}
                      </span>
                    </span>
                  </div>
                ),
              )
            )}
          </div>
        </div>
      )}
    </section>
  );
}