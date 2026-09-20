                                                                          
import { memo, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  TerminalSquare,
  X,
} from 'lucide-react';

import type { RuntimeActivity } from '../../../runtime/events/runtime-events.types';
import DiffViewer, { looksLikeDiff } from './DiffViewer';
import WebSearchToolCard from './WebSearchToolCard';
import { useLocalize } from '../../../../../localization/useLocalize';
import { useRuntimePresentation } from '../../../../../localization/useRuntimePresentation';

type Props = {
  activity: RuntimeActivity;

};

function ToolCallRow(props: Props) {
  return props.activity.operation === 'web.search' ? (
    <WebSearchToolCard {...props} />
  ) : (
    <GenericToolCallRow {...props} />
  );
}

function GenericToolCallRow({
  activity,
  }: Props) {
  const t = useLocalize();
  const { statusLabel } = useRuntimePresentation();
  const [open, setOpen] = useState(
    activity.status === 'failed',
  );

  const detail = activity.detail ?? {};

  const args = useMemo(
    () =>
      stringify(
        detail.argumentsPreview ??
          detail.argsPreview ??
          detail.inputPreview,
      ),
    [detail],
  );

  const output = useMemo(
    () =>
      String(
        detail.outputSummary ??
          activity.summary ??
          detail.error ??
          '',
      ),
    [detail, activity.summary],
  );

  const running =
    activity.status === 'running' ||
    activity.status === 'queued';

  const failed =
    activity.status === 'failed' ||
    activity.status === 'blocked';

  const icon = running ? (
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

  const hasBody = Boolean(
    args ||
      output ||
      activity.evidenceRefs.length,
  );

  return (
    <section
      className={`
        mb-[5px]
        overflow-hidden
        rounded-[10px]
        ${
          'bg-surface-deep text-neutral-800  dark:text-[#888888]'
        }
      `}
      data-activity-id={activity.activityId}
    >
      <button
        type="button"
        disabled={!hasBody}
        onClick={() => {
          if (hasBody) {
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
            hasBody
              ? 'hover:bg-neutral-50 dark:hover:bg-[#121212]'
              : ''
          }
        `}
      >
        <TerminalSquare
          size={14}
          className="shrink-0 opacity-65"
        />

        <span className="min-w-0 flex-1 truncate font-medium">
          {activity.title}
        </span>

        {activity.progress?.total != null && (
          <span className="shrink-0 text-[10px] opacity-50">
            {activity.progress.completed}/
            {activity.progress.total}
          </span>
        )}

        <span
          className={`
            flex
            shrink-0
            items-center
            gap-1
            ${statusTone}
          `}
        >
          {icon}
          <span>{statusLabel(activity.status)}</span>
        </span>

        {hasBody &&
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

      {open && hasBody && (
        <div
          className={`
            space-y-[10px]
            px-[10px]
            py-[10px]
            ${
              'bg-neutral-50 text-neutral-500 dark:bg-[#1f1f1f] dark:text-[#888888]'
            }
          `}
        >
          {args && (
            <Detail title={t('runtime.detail.input')}>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
                {args}
              </pre>
            </Detail>
          )}

          {output && (
            <Detail title={failed ? t('runtime.detail.error') : t('runtime.detail.output')}>
              {looksLikeDiff(output) ? (
                <DiffViewer
                  value={output}

                />
              ) : (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
                  {output}
                </pre>
              )}
            </Detail>
          )}

          {activity.evidenceRefs.length > 0 && (
            <div className="text-[10px] opacity-60">
              {t('runtime.detail.evidence')} ·{' '}
              {activity.evidenceRefs
                .slice(0, 6)
                .join(', ')}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Detail({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] opacity-45">
        {title}
      </div>

      {children}
    </div>
  );
}

function stringify(value: unknown): string {
  if (value == null || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default memo(ToolCallRow);