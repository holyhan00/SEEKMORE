import { useAppearance } from '../../../theme/useAppearance';
                                                                 

import type {
  ClipboardEvent,
  SyntheticEvent,
} from 'react';

import {
  resolveAssetUrl,
} from '../../../utils/asset-url';

import type {
  ExploreResourceItem,
} from '../explore.types';
import { useLocalize } from '../../../localization/useLocalize';
import { useSystemResourcePresentation } from '../../../localization/useSystemResourcePresentation';

function actionLabel(
  item: ExploreResourceItem,
  localize: (key: string, values?: Record<string, unknown>) => string,
): string {
  if (item.resourceType === 'AGENT') {
    return item.actionState === 'ADDED'
      ? localize('explore.action.added')
      : item.actionState === 'AUTHORIZE'
        ? localize('explore.action.authorize')
        : localize('explore.action.add');
  }

  if (item.resourceType === 'SKILL') {
    return item.actionState === 'INSTALLED'
      ? localize('explore.action.installed')
      : localize('explore.action.install');
  }

  const keyByState: Record<string, string> = {
    CONNECTED: 'explore.action.connected',
    CONNECTING: 'explore.action.connecting',
    RECONNECT: 'explore.action.reconnect',
    CONFIGURE: 'explore.action.configure',
    RECONFIGURE: 'explore.action.reconfigure',
    SETUP: 'explore.action.setup',
    DISABLED: 'explore.action.disabled',
    AUTHORIZE: 'explore.action.authorize',
    CONNECT: 'explore.action.connect',
    INSTALL: 'explore.action.install',
  };

  return localize(
    keyByState[item.actionState]
      ?? 'explore.action.install',
  );
}

function resourceTypeLabel(
  item: ExploreResourceItem,
  localize: (key: string, values?: Record<string, unknown>) => string,
): string {
  if (item.resourceType === 'AGENT') {
    return localize('explore.type.agent');
  }

  if (item.resourceType === 'SKILL') {
    return localize('explore.type.skill');
  }

  const keyByAvailability: Record<string, string> = {
    oauth: 'explore.type.mcpOauth',
    credential: 'explore.type.mcpCredential',
    local_setup: 'explore.type.mcpLocal',
    ready: 'explore.type.mcpReady',
  };

  return localize(
    keyByAvailability[item.availability]
      ?? 'explore.type.mcpReady',
  );
}

function resourceAvatar(
  item: ExploreResourceItem,
): string {
  if (item.resourceType === 'AGENT') {
    return resolveAssetUrl(
      item.avatarKey,
      {
        fallback: resolveAssetUrl('/logo.svg'),
      },
    );
  }

  if (item.resourceType === 'SKILL') {
    return resolveAssetUrl(
      item.iconKey,
      {
        fallback:
          resolveAssetUrl('/icons/skill.svg'),
      },
    );
  }

  const fallback = item.stableKey
    ? resolveAssetUrl(`/builtin/mcp/avatars/${encodeURIComponent(
        item.stableKey,
      )}.jpg`)
    : resolveAssetUrl('/icons/mcp.svg');

  return resolveAssetUrl(
    item.iconKey,
    {
      fallback,
    },
  );
}

function resourceCover(
  item: ExploreResourceItem,
): string | null {
  if (
    item.resourceType === 'AGENT'
    || item.resourceType === 'SKILL'
  ) {
    const coverKey =
      item.coverKey?.trim();

    return coverKey
      ? resolveAssetUrl(coverKey)
      : null;
  }

  return item.stableKey
    ? resolveAssetUrl(`/builtin/mcp/covers/${encodeURIComponent(
        item.stableKey,
      )}.jpg`)
    : null;
}

function actionDisabled(
  item: ExploreResourceItem,
): boolean {
  if (item.resourceType === 'AGENT') {
    return (
      item.actionState === 'ADDED'
    );
  }

  if (item.resourceType === 'SKILL') {
    return (
      item.actionState ===
      'INSTALLED'
    );
  }

  return [
    'CONNECTED',
    'CONNECTING',
    'DISABLED',
  ].includes(item.actionState);
}

export default function ExploreResourceCard({
  item,
  busy,
  onAction,
}: {
  item: ExploreResourceItem;

  busy: boolean;
  onAction: (
    item: ExploreResourceItem,
  ) => void;
}) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme =
    resolvedTheme === 'dark';

  const localize = useLocalize();

  const systemPresentation =
    useSystemResourcePresentation();

  const mcpProductIntroduction =
    item.resourceType === 'MCP'
      ? systemPresentation.mcpText({
          source: item.source,
          stableKey: item.stableKey,
          field: 'productIntroduction',
          fallback:
            item.productIntroduction,
        })
      : '';

  const mcpDescription =
    item.resourceType === 'MCP'
      ? systemPresentation.mcpText({
          source: item.source,
          stableKey: item.stableKey,
          field: 'description',
          fallback: item.description,
        })
      : '';

  const mcpConfigurationHint =
    item.resourceType === 'MCP'
      ? item.configurationHintPresentation?.key
        ? localize(
            item.configurationHintPresentation.key,
            {
              ...(
                item.configurationHintPresentation
                  .params ?? {}
              ),
              defaultValue:
                item.configurationHint,
            },
          )
        : item.configurationHint
      : '';

  const backgroundUrl =
    isDarkTheme
      ? resolveAssetUrl('/backgrounds/agent-card-dark.jpg')
      : resolveAssetUrl('/backgrounds/agent-card-light.jpg');

  const coverUrl =
    resourceCover(item);

  const avatarUrl =
    resourceAvatar(item);

  const textColor =
    'text-gray-800 dark:text-[#ffffff]';

  const coverFallback =
    'bg-[#ffffff] dark:bg-[#1b1f35]';

  const avatarFallback =
    'bg-accent-surface text-accent-foreground  ';

  const disabled =
    actionDisabled(item);

  return (
    <article
      className={`
        relative
        h-[240px]
        w-[180px]
        overflow-hidden
        rounded-[15px]
        border
        border-transparent
        select-none
        transition-all
        duration-200
        hover:-translate-y-[2px]
        hover:shadow-[0_18px_40px_rgba(12,92,251,0.18)]
        ${textColor}
      `}
    >
      <img
        src={backgroundUrl}
        alt=""
        className="
          absolute
          inset-0
          h-full
          w-full
          object-cover
        "
        draggable={false}
      />

      <div
        className={`
          absolute
          inset-0
          ${
            'bg-surface-overlay-soft '
          }
        `}
      />

      <div
        className="
          relative
          z-[1]
          mb-[6px]
          mt-[10px]
          flex
          w-full
          justify-center
          p-2
        "
      >
        <div
          className={`
            relative
            h-[90px]
            w-[160px]
            overflow-hidden
            rounded-[12px]
            shadow-sm
            ${coverFallback}
          `}
        >
          <div
            className="
              absolute
              inset-0
              flex
              select-none
              items-center
              justify-center
              text-[12px]
              font-normal
              opacity-35
            "
          >
            {localize('common.cover')}
          </div>

          {coverUrl && (
            <img
              src={coverUrl}
              alt={localize(
                'explore.coverAlt',
                {
                  name: item.name,
                },
              )}
              className="
                absolute
                inset-0
                h-full
                w-full
                object-cover
              "
              draggable={false}
              onError={(
                event:
                  SyntheticEvent<HTMLImageElement>,
              ) => {
                event.currentTarget
                  .style.display = 'none';
              }}
            />
          )}

          <div
            className={`
              pointer-events-none
              absolute
              inset-0
              ${
                'bg-surface-overlay-soft '
              }
            `}
          />
        </div>

        <div
          className={`
            absolute
            bottom-[-10px]
            left-[18px]
            h-[34px]
            w-[34px]
            overflow-hidden
            rounded-[6px]
            shadow-md
            ${avatarFallback}
          `}
        >
          <div
            className="
              absolute
              inset-0
              flex
              select-none
              items-center
              justify-center
              text-[16px]
              font-normal
            "
          >
            {item.name.trim()[0] || 'S'}
          </div>

          <img
            src={avatarUrl}
            alt={localize(
              'explore.avatarAlt',
              {
                name: item.name,
              },
            )}
            className="
              absolute
              inset-0
              h-full
              w-full
              object-cover
            "
            draggable={false}
            onError={(
              event:
                SyntheticEvent<HTMLImageElement>,
            ) => {
              event.currentTarget
                .style.display = 'none';
            }}
          />
        </div>
      </div>

      <div
        className="
          mx-auto
          w-[150px]
          pt-[2px]
        "
      >
        <div
          className="
            relative
            z-[1]
          "
        >
          <div
            className="
              flex
              items-center
              justify-between
              gap-2
            "
          >
            <h3
              className="
                min-w-0
                flex-1
                truncate
                mt-[10px]
                text-[14px]
                font-normal
                leading-[20px]
              "
              title={item.name}
            >
              {item.name}
            </h3>

            <span
              className="
                shrink-0
                rounded-full
                bg-blue-600
                px-[6px]
                py-[1px]
                text-[8px]
                font-normal
                leading-[12px]
                text-[#ffffff]
              "
              title={
                item.resourceType === 'MCP'
                  ? mcpConfigurationHint
                  : undefined
              }
            >
              {resourceTypeLabel(
                item,
                localize,
              )}
            </span>
          </div>

          {item.resourceType === 'MCP' ? (
            <>
              <p
                className="
                  mt-[2px]
                  line-clamp-1
                  w-full
                  text-[10px]
                  font-normal
                  leading-[12px]
                  opacity-75
                "
                title={
                  mcpProductIntroduction
                }
              >
                {mcpProductIntroduction
                  || localize(
                    'explore.noProductIntroduction',
                  )}
              </p>

              <p
                className="
                  mt-[8px]
                  line-clamp-2
                  w-full
                  text-[9px]
                  font-normal
                  leading-[11px]
                  opacity-50
                "
                title={
                  mcpDescription || ''
                }
              >
                {mcpDescription
                  || localize(
                    'explore.noMcpDescription',
                  )}
              </p>
            </>
          ) : (
            <p
              className="
                mt-[4px]
                line-clamp-2
                w-full
                text-[10px]
                font-normal
                leading-[12px]
                opacity-70
              "
              title={
                item.description || ''
              }
            >
              {item.description
                || localize(
                  'common.noDescription',
                )}
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={
            disabled || busy
          }
          onClick={() =>
            onAction(item)
          }
          onCopy={(
            event:
              ClipboardEvent<HTMLButtonElement>,
          ) => {
            event.preventDefault();
          }}
          className={`
            absolute
            bottom-[12px]
            left-[15px]
            z-[5]
            flex
            h-[28px]
            w-[150px]
            select-none
            items-center
            justify-center
            rounded-full
            text-[12px]
            font-normal
            text-[#ffffff]
            shadow-sm
            transition-all
            duration-150
            ${
              disabled
                ? 'bg-[#282828]/20 text-[#777777] dark:bg-[#ffffff]/10 dark:text-[#ffffff]/45'
                : `
                  bg-[#0c5cfb]
                  hover:-translate-y-[1px]
                  hover:bg-[#084bd8]
                  hover:text-[#ffffff]
                  hover:shadow-[0_6px_16px_rgba(12,92,251,0.25)]
                  active:translate-y-0
                `
            }
            disabled:cursor-default
            disabled:hover:translate-y-0
          `}
        >
          {busy
            ? localize(
                'common.processing',
              )
            : actionLabel(
                item,
                localize,
              )}
        </button>
      </div>
    </article>
  );
}

export function ExploreResourceGrid({
  items,
  busyId,
  onAction,
  align = 'center',
}: {
  items: ExploreResourceItem[];

  busyId: string | null;
  onAction: (
    item: ExploreResourceItem,
  ) => void;
  align?: 'start' | 'center';
}) {
  return (
    <div
      className={`
        grid
        w-full
        min-w-0
        grid-cols-[repeat(auto-fill,144px)]
        gap-[10px]
        ${
          align === 'start'
            ? 'justify-start'
            : 'justify-center'
        }
      `}
    >
      {items.map((item) => (
        <div
          key={`${item.resourceType}:${item.id}`}
          className="
            h-[192px]
            w-[144px]
          "
        >
          <div
            className="
              origin-top-left
              scale-[0.8]
            "
          >
            <ExploreResourceCard
              item={item}
              busy={
                busyId === item.id
              }
              onAction={onAction}
            />
          </div>
        </div>
      ))}
    </div>
  );
}