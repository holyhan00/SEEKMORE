// frontend/src/components/chat/ChatMessage/segments/AssistantExecutionPanel.tsx
import { resolveAssetUrl } from '../../../../utils/asset-url';
import { useAppearance } from '../../../../theme/useAppearance';
                                                                                

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Virtuoso,
  type VirtuosoHandle,
} from 'react-virtuoso';
import {
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

import AuroraBorder from '../../../ui/AuroraBorder';
import type {
  AssistantExecutionGroup,
} from './runtime-display.types';
import ExecutionStepGroup from './ExecutionStepGroup';
import { useLocalize } from '../../../../localization/useLocalize';
import { useRuntimePresentation } from '../../../../localization/useRuntimePresentation';
import type { ChatObjectCard } from '../../../../utils/types';
import { useObjectPreview } from '../../object-preview/ObjectPreviewProvider';

interface AssistantExecutionPanelProps {
  groups: AssistantExecutionGroup[];
  objects?: ChatObjectCard[];

  turnActive: boolean;
  onLink?: (
    href: string,
  ) => boolean;
}

function AssistantExecutionPanel({
  groups,
  objects = [],
  turnActive,
  onLink,
}: AssistantExecutionPanelProps) {
  const { resolvedTheme } = useAppearance();
  const isDarkTheme = resolvedTheme === 'dark';
  const { openObject } = useObjectPreview();
  const t = useLocalize();
  const { activityTitle, activitySummary, stepTitle } = useRuntimePresentation();
  const [expanded, setExpanded] =
    useState(turnActive);
  const [userAtBottom, setUserAtBottom] =
    useState(true);
  const [now, setNow] =
    useState(() => Date.now());

  const previousTurnActiveRef =
    useRef(turnActive);
  const detailVirtuosoRef =
    useRef<VirtuosoHandle>(null);
  const setAtBottom =
    useCallback((value: boolean) => {
      setUserAtBottom(
        (previous) =>
          previous === value
            ? previous
            : value,
      );
    }, []);

  const displayGroups =
    useMemo(
      () =>
        groups.filter(
          hasDisplayContent,
        ),
      [groups],
    );

  const currentGroup =
    useMemo(() => {
      for (
        let index = groups.length - 1;
        index >= 0;
        index -= 1
      ) {
        const group = groups[index];

        if (
          group.step.finishedAt
          == null
        ) {
          return group;
        }
      }

      return groups[
        groups.length - 1
      ] ?? null;
    }, [groups]);

  const totalTiming =
    useMemo(
      () => resolveTotalTiming(groups),
      [groups],
    );

  const totalDurationRunning =
    Boolean(
      turnActive
      && totalTiming.startedAt != null,
    );

  useEffect(() => {
    const previousTurnActive =
      previousTurnActiveRef.current;

    if (
      !previousTurnActive
      && turnActive
    ) {
      setAtBottom(true);
      setExpanded(true);
    } else if (
      previousTurnActive
      && !turnActive
    ) {
      setExpanded(false);
    }

    previousTurnActiveRef.current =
      turnActive;
  }, [setAtBottom, turnActive]);

  useEffect(() => {
    if (!totalDurationRunning) {
      return undefined;
    }

    setNow(Date.now());

    const timer = window.setInterval(
      () => setNow(Date.now()),
      1000,
    );

    return () => {
      window.clearInterval(timer);
    };
  }, [totalDurationRunning]);

  const toggleExpanded =
    useCallback(() => {
      setExpanded((previous) => {
        const next = !previous;

        if (next) {
          setAtBottom(true);
        }

        return next;
      });
    }, [setAtBottom]);

  const handleTotalListHeightChanged =
    useCallback(() => {
      if (!userAtBottom) {
        return;
      }

      detailVirtuosoRef.current
        ?.autoscrollToBottom();
    }, [userAtBottom]);

  if (!currentGroup) {
    return null;
  }

  const liveText = resolveLocalizedGroupSummary(
    currentGroup,
    activityTitle,
    activitySummary,
    stepTitle,
  ) || t('runtime.currentTask');
  const duration =
    resolveTotalDuration(
      totalTiming,
      now,
      turnActive,
    );

  const header = (
    <button
      type="button"
      onClick={toggleExpanded}
      className={`flex h-[32px] w-full min-w-0 shrink-0 items-center overflow-hidden pl-0 pr-[10px] text-left text-[10px] leading-[20px] ${
        expanded
          ? 'rounded-t-[12px]'
          : 'rounded-[0px]'
      } ${
        'bg-surface-chat text-[#585858]  dark:text-[#a0a0a0]'
      }`}
      aria-expanded={expanded}
    >
      <img
        src={resolveAssetUrl('/logo.svg')}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={` mr-[10px] block h-[5px] w-auto max-w-none shrink-0 select-none ${
          turnActive
            ? 'assistant-execution-logo-active'
            : ''
        }`}
        style={{
          filter: isDarkTheme
            ? 'brightness(0) invert(1)'
            : 'brightness(0)',
          opacity: turnActive
            ? undefined
            : 0.35,
        }}
      />

      <span
        className="min-w-0 flex-1 truncate font-normal whitespace-nowrap opacity-60"
        title={liveText}
      >
        {liveText}
      </span>

      {duration && (
        <span className="ml-[7px] shrink-0 text-[10px] opacity-35">
          {duration}
        </span>
      )}

      <span className="ml-[7px] flex h-[16px] w-[16px] shrink-0 items-center justify-center opacity-55">
        {expanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
      </span>
    </button>
  );

  const detailClassName =
    `min-h-0 flex-1 overflow-x-hidden rounded-b-[12px] overscroll-contain [overflow-anchor:none] ${
      'bg-[#f4f4f4] text-[#585858] dark:bg-[#191919] dark:text-[#a0a0a0]'
    } [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:max-w-full [&_code]:break-words [&_code]:[overflow-wrap:anywhere]`;

  return (
    <section className="my-2 w-full min-w-0 max-w-full select-none">
      <div
        className={`flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[10px] ${
          expanded
            ? 'h-[180px]'
            : 'h-[32px]'
        }`}
      >
        {turnActive ? (
          <AuroraBorder
            className="w-full shrink-0"
            tone={
              isDarkTheme
                ? 'dark'
                : 'light'
            }
            motion="perimeter"
            radius={12}
            borderWidth={1}
            duration={4}
          >
            {header}
          </AuroraBorder>
        ) : (
          <div className="w-full shrink-0">
            {header}
          </div>
        )}

        {expanded && objects.length > 0 && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[#e7e7e7] px-[10px] py-[5px] dark:border-[#242424]">
            {objects.map((object) => (
              <button
                key={object.objectId}
                type="button"
                onClick={() => openObject(object, objects)}
                className="flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-[6px] bg-[#000000]/[0.035] px-2 py-1 text-[9px] leading-[14px] opacity-75 transition hover:opacity-100 dark:bg-[#ffffff]/[0.055]"
                title={object.displayName}
              >
                <Check size={10} className="shrink-0" />
                <span className="truncate">{object.displayName}</span>
              </button>
            ))}
          </div>
        )}

        {expanded && (
          <Virtuoso
            ref={detailVirtuosoRef}
            data={displayGroups}
            className={detailClassName}
            itemContent={(
              _index: number,
              group: AssistantExecutionGroup,
            ) => (
              <div className="px-[10px]">
                <ExecutionStepGroup
                  group={group}

                  onLink={onLink}
                />
              </div>
            )}
            computeItemKey={(
              _index: number,
              group: AssistantExecutionGroup,
            ) => group.segmentId}
            initialTopMostItemIndex={
              displayGroups.length > 0
                ? displayGroups.length - 1
                : undefined
            }
            atBottomStateChange={
              setAtBottom
            }
            totalListHeightChanged={
              handleTotalListHeightChanged
            }
            followOutput={
              userAtBottom
                ? 'auto'
                : false
            }
            increaseViewportBy={60}
          />
        )}
      </div>
    </section>
  );
}

function resolveLocalizedGroupSummary(
  group: AssistantExecutionGroup,
  activityTitle: (activity: AssistantExecutionGroup['activities'][number]) => string,
  activitySummary: (activity: AssistantExecutionGroup['activities'][number]) => string,
  stepTitle: (step: AssistantExecutionGroup['step']) => string,
): string {
  if (group.commentary.some((item) => item.markdown.trim())) {
    return group.summary.trim();
  }
  if (group.reasoning.some((item) => item.markdown.trim())) {
    return group.summary.trim();
  }
  const activity = group.activities[group.activities.length - 1];
  if (activity) {
    return activitySummary(activity).trim() || activityTitle(activity);
  }
  return stepTitle(group.step).trim();
}

function hasDisplayContent(
  group: AssistantExecutionGroup,
): boolean {
  return group.commentary.some(
    (segment) =>
      segment.markdown.trim().length > 0,
  ) || group.reasoning.some(
    (summary) =>
      summary.markdown.trim().length > 0,
  ) || group.activities.length > 0;
}

function resolveTotalTiming(
  groups: AssistantExecutionGroup[],
): {
  startedAt: number | null;
  finishedAt: number | null;
} {
  let startedAt: number | null = null;
  let finishedAt: number | null = null;

  for (const group of groups) {
    const groupStartedAt =
      finiteTimestamp(
        group.timing?.startedAt,
      )
      ?? finiteTimestamp(
        group.step.startedAt,
      );

    if (
      groupStartedAt != null
      && (
        startedAt == null
        || groupStartedAt < startedAt
      )
    ) {
      startedAt = groupStartedAt;
    }

    const timingDuration =
      finiteTimestamp(
        group.timing?.durationMs,
      );
    const durationFinishedAt =
      groupStartedAt != null
      && timingDuration != null
        ? groupStartedAt
          + timingDuration
        : null;
    const groupFinishedAt =
      finiteTimestamp(
        group.timing?.finishedAt,
      )
      ?? finiteTimestamp(
        group.step.finishedAt,
      )
      ?? durationFinishedAt;

    if (
      groupFinishedAt != null
      && (
        finishedAt == null
        || groupFinishedAt > finishedAt
      )
    ) {
      finishedAt = groupFinishedAt;
    }
  }

  return {
    startedAt,
    finishedAt,
  };
}

function resolveTotalDuration(
  timing: {
    startedAt: number | null;
    finishedAt: number | null;
  },
  now: number,
  running: boolean,
): string {
  if (timing.startedAt == null) {
    return '';
  }

  const finishedAt = running
    ? now
    : timing.finishedAt;

  if (finishedAt == null) {
    return '';
  }

  const value = Math.max(
    0,
    finishedAt - timing.startedAt,
  );
  const seconds = Math.floor(
    value / 1000,
  );
  const minutes = Math.floor(
    seconds / 60,
  );
  const remainder = seconds % 60;

  return minutes > 0
    ? `${minutes}:${String(remainder).padStart(2, '0')}`
    : `${seconds}s`;
}

function finiteTimestamp(
  value: number | null | undefined,
): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
      ? value
      : null;
}

function sameObjects(
  left: ChatObjectCard[] | undefined,
  right: ChatObjectCard[] | undefined,
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length
    && a.every((object, index) =>
      object.objectId === b[index]?.objectId
      && object.position === b[index]?.position,
    );
}

function samePanelProps(
  previous: AssistantExecutionPanelProps,
  next: AssistantExecutionPanelProps,
): boolean {
  return previous.turnActive === next.turnActive
    && previous.onLink === next.onLink
    && sameObjects(previous.objects, next.objects)
    && previous.groups.length === next.groups.length
    && previous.groups.every(
      (group, index) =>
        group === next.groups[index],
    );
}

export default memo(
  AssistantExecutionPanel,
  samePanelProps,
);