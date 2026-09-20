                                                                                
import { memo, useMemo, useState } from 'react';
import { useLocalize } from '../../../../../localization/useLocalize';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Search,
  X,
} from 'lucide-react';

import type { RuntimeActivity } from '../../../runtime/events/runtime-events.types';
import type {
  WebSearchCardHit,
  WebSearchCardResult,
} from '../../../runtime/web-search/web-search.types';

type Props = {
  activity: RuntimeActivity;

};

function WebSearchToolCard({
  activity,
  }: Props) {
  const localize = useLocalize();
  const [open, setOpen] = useState(
    activity.status === 'failed',
  );

  const detail = activity.detail ?? {};

  const result = useMemo(
    () => extractResult(detail),
    [detail],
  );

  const running =
    activity.status === 'running' ||
    activity.status === 'queued';

  const failed =
    activity.status === 'failed' ||
    activity.status === 'blocked';

  const statusIcon = running ? (
    <CircleDashed
      size={14}
      className="animate-spin"
    />
  ) : failed ? (
    <X size={14} />
  ) : (
    <Check size={14} />
  );

  const statusTone = failed
    ? 'text-red-500'
    : running
      ? 'text-blue-600 dark:text-blue-300'
      : 'text-emerald-600 dark:text-emerald-300';

  const hasDetails = Boolean(
    result.query ||
      result.hits.length ||
      activity.summary ||
      detail.error,
  );

  return (
    <section
      className={`
        mb-[5px]
        overflow-hidden
        rounded-[10px]
        ${
          'bg-surface-deep text-neutral-800  dark:text-neutral-300'
        }
      `}
      data-activity-id={activity.activityId}
    >
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => {
          if (hasDetails) {
            setOpen((value) => !value);
          }
        }}
        className={`
          flex
          h-[32px]
          w-full
          items-center
          gap-[5px]
          px-[12px]
          text-left
          text-[8px]
          transition-colors
          ${
            'bg-surface-deep text-neutral-700  dark:text-[#888888]'
          }
          ${
            hasDetails
              ? 'hover:bg-neutral-50 dark:hover:bg-[#121212]'
              : ''
          }
        `}
      >
        <Search
          size={14}
          className="shrink-0 opacity-70"
        />

        <span className="min-w-0 flex-1 truncate font-medium">
          {activity.title || localize('webSearch.local')}
        </span>

        <span
          className={`
            flex
            shrink-0
            items-center
            gap-1
            ${statusTone}
          `}
        >
          {statusIcon}
          <span>{localize(statusKey(activity.status))}</span>
        </span>

        {hasDetails &&
          (open ? (
            <ChevronDown
              size={13}
              className="shrink-0 opacity-45"
            />
          ) : (
            <ChevronRight
              size={13}
              className="shrink-0 opacity-45"
            />
          ))}
      </button>

      {open && hasDetails && (
        <div
          className={`
            space-y-3
            border-t
            py-[10px]
            ${
              'border-neutral-100 bg-neutral-50/70 dark:border-[#333333] dark:bg-[#181818] dark:text-[#888888]'
            }
          `}
        >
          {result.query && (
            <div className="px-[10px]">
              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] opacity-45">
                {localize('webSearch.card.query')}
              </div>

              <div className="break-words text-xs">
                {result.query}
              </div>
            </div>
          )}

          {result.hits.length > 0 && (
            <div>
              <div className="mb-[10px] px-[10px] text-[10px] uppercase tracking-[0.12em] opacity-45">
                {localize('webSearch.card.sources')}
              </div>

              <div className="space-y-[10px]">
                {result.hits
                  .slice(0, 8)
                  .map((hit, index) => (
                    <SearchHit
                      key={`${hit.evidenceRef ?? hit.url}-${index}`}
                      hit={hit}

                    />
                  ))}
              </div>
            </div>
          )}

          {!result.hits.length &&
            Boolean(
              activity.summary ||
                detail.error,
            ) && (
              <pre className="mx-[10px] max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 opacity-70">
                {String(
                  detail.error ??
                    activity.summary ??
                    '',
                )}
              </pre>
            )}

          {activity.evidenceRefs.length > 0 && (
            <div className="px-[10px] text-[10px] opacity-50">
              {localize('runtime.detail.evidence')} ·{' '}
              {activity.evidenceRefs
                .slice(0, 8)
                .join(', ')}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

async function openSource(
  url: string,
): Promise<void> {
  const desktopOpen =
    window.seekmoreDesktop?.web?.openExternal;

  if (desktopOpen) {
    try {
      const result = await desktopOpen(url);

      if (result.opened) {
        return;
      }
    } catch {
                                                 
    }
  }

  window.open(
    url,
    '_blank',
    'noopener,noreferrer',
  );
}

function SearchHit({
  hit,
  }: {
  hit: WebSearchCardHit;

}) {
  const localize = useLocalize();
  return (
    <article
      className={`
        mx-[10px]
        rounded-[9px]
        px-[10px]
        py-[10px]
        ${
          'bg-[#ffffff] dark:bg-[#222222]'
        }
      `}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              void openSource(hit.url);
            }}
            className={`
              inline-flex
              max-w-full
              items-center
              gap-1
              text-left
              text-xs
              font-medium
              ${
                'text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200'
              }
            `}
            title={localize('webSearch.card.openBrowser')}
          >
            <span className="truncate">
              {hit.title || hit.url}
            </span>

            <ExternalLink
              size={11}
              className="shrink-0"
            />
          </button>

          {hit.summary && (
            <p className="mt-1 line-clamp-3 text-[11px] leading-5 opacity-65">
              {hit.summary}
            </p>
          )}
        </div>

        {hit.sourceType && (
          <span
            className={`
              shrink-0
              rounded-full
              px-1.5
              py-0.5
              text-[9px]
              opacity-55
              ${
                'bg-[#000000]/5 dark:bg-[#ffffff]/10'
              }
            `}
          >
            {sourceLabel(hit.sourceType)}
          </span>
        )}
      </div>
    </article>
  );
}

function extractResult(
  detail: Record<string, unknown>,
): WebSearchCardResult {
  const argumentsRecord =
    record(detail.arguments);

  return {
    query:
      text(argumentsRecord.query) ??
      text(argumentsRecord.q),
    mode: null,
    safetyNotice: null,
    hits: [],
    diagnostics: null,
  };
}

function sourceLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ');
}

function record(
  value: unknown,
): Record<string, any> {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function text(
  value: unknown,
): string | null {
  const output = String(value ?? '').trim();

  return output || null;
}

function statusKey(
  status: RuntimeActivity['status'],
): string {
  return {
    queued: 'webSearch.status.queued',
    running: 'webSearch.status.searching',
    waiting: 'webSearch.status.waiting',
    blocked: 'webSearch.status.blocked',
    succeeded: 'webSearch.status.completed',
    failed: 'webSearch.status.failed',
    partial: 'webSearch.status.partial',
    cancelled: 'webSearch.status.cancelled',
    skipped: 'webSearch.status.skipped',
  }[status];
}

export default memo(WebSearchToolCard);