import { resolveAssetUrl } from '../../../utils/asset-url';
                                                                  

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  listRuntimeTools,
  updateRuntimeToolEnabled,
} from './api/tool-registry.api';
import type {
  ToolRegistryItem,
} from './api/tool-registry.types';
import ToolPluginCard from './ToolPluginCard';
import { useLocalize } from '../../../localization/useLocalize';
import { useAppearance } from '../../../theme/useAppearance';

interface ToolPluginLibraryPageProps {

}

export default function ToolPluginLibraryPage({
}: ToolPluginLibraryPageProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme =
    resolvedTheme === 'dark';

  const localize = useLocalize();

  const [tools, setTools] = useState<
    ToolRegistryItem[]
  >([]);

  const updatingToolNamesRef = useRef(
    new Set<string>(),
  );

  const [
    updatingToolNames,
    setUpdatingToolNames,
  ] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const refresh = useCallback(
    async () => {
      try {
        const response =
          await listRuntimeTools();

        setTools(
          Array.isArray(
            response.tools,
          )
            ? response.tools
            : [],
        );
      } catch {
                           
      }
    },
    [],
  );

  const handleEnabledChange =
    useCallback(
      async (
        tool: ToolRegistryItem,
        enabled: boolean,
      ) => {
        const toolName = String(
          tool.name ?? '',
        ).trim();

        if (
          !toolName ||
          updatingToolNamesRef.current.has(
            toolName,
          )
        ) {
          return;
        }

        updatingToolNamesRef.current.add(
          toolName,
        );

        setUpdatingToolNames(
          new Set(
            updatingToolNamesRef.current,
          ),
        );

        try {
          const response =
            await updateRuntimeToolEnabled(
              toolName,
              enabled,
            );

          setTools(
            Array.isArray(
              response.tools,
            )
              ? response.tools
              : [],
          );
        } catch {
                          
        } finally {
          updatingToolNamesRef.current.delete(
            toolName,
          );

          setUpdatingToolNames(
            new Set(
              updatingToolNamesRef.current,
            ),
          );
        }
      },
      [],
    );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main
      className={`h-full min-h-0 overflow-y-auto overscroll-contain select-none [&_button]:!select-none [&_button_*]:!select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
        'bg-surface-page '
      }`}
    >
      <div className="mx-auto w-[95%] min-w-0">
        <header
          className="
            relative
            flex
            min-h-[132px]
            items-end
            justify-between
            overflow-hidden
            rounded-[18px]
            bg-cover
            bg-center
            bg-no-repeat
            px-[22px]
          "
          style={{
            backgroundImage: `url("${
              isDarkTheme
                ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
                : resolveAssetUrl('/backgrounds/agent-card-light.jpg')
            }")`,
          }}
          onCopy={(event) =>
            event.preventDefault()
          }
        >
          <div
            className={`pointer-events-none absolute inset-0 ${
              'bg-surface-inverse-soft '
            }`}
          />

          <div
            className="
              relative
              bottom-[16px]
              z-10
              flex
              min-w-0
              select-none
              flex-col
              gap-0
            "
          >
            <h1
              className={`m-0 select-none text-[27px] font-semibold leading-[50px] tracking-[-0.035em] ${
                'text-theme-title '
              }`}
            >
              {localize(
                'tools.library.title',
              )}
            </h1>

            <p
              className={`m-0 select-none text-[12px] leading-[10px] ${
                'text-theme-subtle '
              }`}
            >
              {localize(
                'tools.library.description',
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void refresh()
            }
            className="
              relative
              bottom-[16px]
              z-10
              flex
              h-10
              shrink-0
              select-none
              items-center
              justify-center
              rounded-[11px]
              bg-action-primary
              px-5
              py-0
              text-[12px]
              font-medium
              text-[#ffffff]
              shadow-[0_10px_24px_rgba(12,92,251,0.2)]
              transition
              hover:bg-action-primary-hover
              hover:!text-[#ffffff]
              active:translate-y-px
            "
          >
            {localize(
              'common.actions.refresh',
            )}
          </button>
        </header>

        <div
          className={`mt-[10px] text-[10px] ${
            'text-theme-dim '
          }`}
        >
          {localize(
            'tools.library.count',
            {
              count: tools.length,
            },
          )}
        </div>

        {tools.length > 0 && (
          <div
            className="
              mt-[16px]
              grid
              w-full
              min-w-[392px]
              items-start
              gap-[16px]
            "
            style={{
              gridTemplateColumns:
                'repeat(3, minmax(120px, 1fr))',
            }}
          >
            {tools.map(
              (tool) => (
                <ToolPluginCard
                  key={`${tool.name}@${
                    tool.version ||
                    '1.0.0'
                  }`}
                  tool={tool}
                  updating={
                    updatingToolNames.has(
                      tool.name,
                    )
                  }
                  onEnabledChange={
                    handleEnabledChange
                  }
                />
              ),
            )}
          </div>
        )}
      </div>
    </main>
  );
}