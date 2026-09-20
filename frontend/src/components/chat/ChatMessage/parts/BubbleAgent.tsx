// frontend/src/components/chat/ChatMessage/parts/BubbleAgent.tsx

import { useRuntimePresentation } from '../../../../localization/useRuntimePresentation';
import { useLocalize } from '../../../../localization/useLocalize';

import {
  useCallback,
  useMemo,
} from 'react';

import type {
  RuntimeApprovalDecision,
} from '../../runtime/approval/runtimeApprovalClient';
import type {
  RuntimeDisplayProjection,
} from '../../runtime/display/runtime-display.types';
import type {
  RuntimeActivity,
} from '../../runtime/events/runtime-events.types';
import type {
  ChatObjectCard,
} from '../../../../utils/types';
import AssistantThinkingState from '../../runtime/status/AssistantThinkingState';
import AssistantExecutionPanel from '../segments/AssistantExecutionPanel';
import MessageObjectCards from '../../object-card/MessageObjectCards';
import RuntimeActivityRow from '../segments/RuntimeActivityRow';
import TextSegmentView from '../segments/TextSegmentView';
import type {
  AssistantExecutionGroup,
  AssistantTimelineItem,
} from '../segments/runtime-display.types';

export interface BubbleAgentProps {
  pureText: string;

  loading: boolean;
  turnActive: boolean;
  citations?: any[] | null;
  runtimeDisplay?:
    RuntimeDisplayProjection
    | null;
  imageObjects?: ChatObjectCard[];
  outputObjects?: ChatObjectCard[];
  onApprovalDecision?: (
    approvalId: string,
    decision:
      RuntimeApprovalDecision,
    taskRunId?: string,
  ) => void;
}

type SurfaceSegment = Exclude<
  AssistantTimelineItem,
  AssistantExecutionGroup
>;

type ImageGenerationActivity =
  RuntimeActivity;

type TurnRenderItem =
  | {
      type: 'execution-panel';
      key:
        'assistant-execution-panel';
      sequence: number;
      groups:
        AssistantExecutionGroup[];
    }
  | {
      type: 'image-gallery';
      key:
        'assistant-image-gallery';
      sequence: number;
    }
  | {
      type: 'segment';
      key: string;
      sequence: number;
      segment: SurfaceSegment;
    };

function buildTurnRenderItems(
  items: AssistantTimelineItem[],
): TurnRenderItem[] {
  const executionGroups =
    items.filter(
      (
        item,
      ): item is AssistantExecutionGroup =>
        item.type
        === 'execution-group',
    );

  const surfaceSegments =
    items.filter(
      (
        item,
      ): item is SurfaceSegment =>
        item.type
        !== 'execution-group',
    );

  const renderItems:
    TurnRenderItem[] =
    surfaceSegments.map(
      (segment) => ({
        type: 'segment',
        key: segment.segmentId,
        sequence:
          segment.sequence,
        segment,
      }),
    );

  if (
    executionGroups.length > 0
  ) {
    const panelSequence =
      Math.min(
        ...executionGroups.map(
          (group) =>
            group.sequence,
        ),
      );

    renderItems.push({
      type: 'execution-panel',
      key:
        'assistant-execution-panel',
      sequence: panelSequence,
      groups: executionGroups,
    });
  }

  return renderItems.sort(
    compareTurnRenderItems,
  );
}

function compareTurnRenderItems(
  left: TurnRenderItem,
  right: TurnRenderItem,
): number {
  const sequenceDifference =
    left.sequence
    - right.sequence;

  if (sequenceDifference !== 0) {
    return sequenceDifference;
  }

  return turnRenderItemPriority(
    left.type,
  ) - turnRenderItemPriority(
    right.type,
  ) || left.key.localeCompare(
    right.key,
  );
}

function turnRenderItemPriority(
  type: TurnRenderItem['type'],
): number {
  if (type === 'execution-panel') {
    return 0;
  }

  if (type === 'image-gallery') {
    return 1;
  }

  return 2;
}

export default function BubbleAgent({
  pureText,
  loading,
  turnActive,
  runtimeDisplay = null,
  imageObjects = [],
  outputObjects = [],
  onApprovalDecision,
}: BubbleAgentProps) {
  const cleanedText = useMemo(
    () =>
      String(pureText ?? '')
        .trim(),
    [pureText],
  );

  const segments = useMemo(
    () => {
      const runtimeItems =
        runtimeDisplay?.items
        ?? [];

      const hasFinal =
        runtimeItems.some(
          (item) =>
            item.type === 'text'
            && item.role === 'final',
        );

      if (
        !cleanedText
        || hasFinal
      ) {
        return runtimeItems;
      }

      const maximumSequence =
        runtimeItems.reduce(
          (maximum, item) =>
            Math.max(
              maximum,
              item.sequence,
            ),
          0,
        );

      return [
        ...runtimeItems,
        {
          segmentId:
            'content:persisted-final',
          type: 'text' as const,
          sequence:
            maximumSequence + 1,
          markdown: cleanedText,
          role: 'final' as const,
          final: !loading,
        },
      ];
    },
    [
      cleanedText,
      loading,
      runtimeDisplay,
    ],
  );

  const sorted = useMemo(
    () =>
      [...segments].sort(
        (left, right) =>
          left.sequence
          - right.sequence
          || left.segmentId.localeCompare(
            right.segmentId,
          ),
      ),
    [segments],
  );

  /*
   * Clarification has its own dedicated interactive
   * surface. Keep the underlying final text in the
   * runtime/persisted projection, but avoid rendering
   * the same question twice in the UI.
   *
   * Do not filter by `waiting` here. A resolved
   * clarification may fade out after the user replies,
   * but its duplicate final text must not suddenly
   * appear afterwards.
   */
  const clarificationActivities =
    useMemo(
      () =>
        sorted.flatMap(
          (segment) => {
            if (
              segment.type
                !== 'activity'
              || segment.activity.kind
                !== 'clarification'
            ) {
              return [];
            }

            return [
              segment.activity,
            ];
          },
        ),
      [sorted],
    );

  const renderItems = useMemo(
    () =>
      buildTurnRenderItems(
        sorted,
      ),
    [sorted],
  );

  const hasExecutionGroups =
    useMemo(
      () =>
        sorted.some(
          (segment) =>
            segment.type
            === 'execution-group',
        ),
      [sorted],
    );

  const runtimeActivities = useMemo(
    () => collectRuntimeActivities(
      runtimeDisplay,
      sorted,
    ),
    [
      runtimeDisplay,
      sorted,
    ],
  );

  const visibleImageObjects = imageObjects;

  const activeImageGenerationActivity =
    useMemo(
      () =>
        findActiveImageGenerationActivity(
          runtimeActivities,
        ),
      [runtimeActivities],
    );

  const imageGenerating =
    activeImageGenerationActivity
    != null;

  const pendingImageMedia = useMemo(
    () => resolvePendingImageMedia(
      activeImageGenerationActivity,
      visibleImageObjects,
    ),
    [
      activeImageGenerationActivity,
      visibleImageObjects,
    ],
  );

  const showImageGallery =
    imageGenerating
    || visibleImageObjects.length > 0;

  const displayRenderItems = useMemo(
    () => {
      if (!showImageGallery) {
        return renderItems;
      }

      const executionPanel =
        renderItems.find(
          (item) =>
            item.type
            === 'execution-panel',
        );

      const maximumSequence =
        renderItems.reduce(
          (maximum, item) =>
            Math.max(
              maximum,
              item.sequence,
            ),
          0,
        );

      return [
        ...renderItems,
        {
          type:
            'image-gallery' as const,
          key:
            'assistant-image-gallery' as const,
          sequence: executionPanel
            ? executionPanel.sequence
              + 0.25
            : maximumSequence + 1,
        },
      ].sort(
        compareTurnRenderItems,
      );
    },
    [
      renderItems,
      showImageGallery,
    ],
  );

  const { presentationText } =
    useRuntimePresentation();
  const t = useLocalize();

  const onLink = useCallback(
    (href: string) => {
      const normalized =
        href.trim().toLowerCase();

      return (
        normalized.startsWith('#cite:')
        || normalized.startsWith('cite:')
      );
    },
    [],
  );

  const pendingActivity =
    runtimeDisplay?.latestPendingActivity
    ?? null;

  const thinkingLabel =
    pendingActivity
      ? presentationText(
          pendingActivity.presentation,
          pendingActivity.title,
        )
      : t('runtime.currentTask');

  const showThinking =
    loading
    && !cleanedText
    && sorted.length === 0;

  return (
    <div className="w-full bg-transparent text-[0.8rem] leading-[1.6rem]">
      {showThinking && (
        <AssistantThinkingState
          label={thinkingLabel}
        />
      )}

      {displayRenderItems.map((item) => {
        if (
          item.type
          === 'execution-panel'
        ) {
          return (
            <AssistantExecutionPanel
              key={item.key}
              groups={item.groups}
              turnActive={
                turnActive
              }
              objects={outputObjects}
              onLink={onLink}
            />
          );
        }

        if (
          item.type
          === 'image-gallery'
        ) {
          return (
            <MessageObjectCards
              key={item.key}
              objects={
                visibleImageObjects
              }
              displayRole="assistant"
              className="mt-3"
              imageGenerating={
                imageGenerating
              }
              pendingImageMedia={
                pendingImageMedia
              }
            />
          );
        }

        const segment =
          item.segment;

        if (
          segment.type === 'text'
        ) {
          if (
            segment.role === 'final'
            && isClarificationDuplicate(
              segment.markdown,
              clarificationActivities,
            )
          ) {
            return null;
          }

          return (
            <TextSegmentView
              key={item.key}
              segment={segment}
              loading={
                loading
                && !segment.final
              }
              onLink={onLink}
            />
          );
        }

        if (
          segment.type
          === 'activity'
        ) {
          const interactive =
            segment.activity.kind
              === 'approval'
            || segment.activity.kind
              === 'clarification';

          if (
            !interactive
            && hasExecutionGroups
          ) {
            return null;
          }

          return (
            <RuntimeActivityRow
              key={item.key}
              activity={
                segment.activity
              }
              onApprovalDecision={
                onApprovalDecision
              }
            />
          );
        }

        return null;
      })}
    </div>
  );
}

function isClarificationDuplicate(
  markdown: string,
  activities:
    RuntimeActivity[],
): boolean {
  const content =
    normalizeClarificationText(
      markdown,
    );

  if (!content) {
    return false;
  }

  return activities.some(
    (activity) => {
      const detail =
        asRecord(
          activity.detail,
        );

      const question =
        normalizeClarificationText(
          detail.question
            ?? activity.summary
            ?? activity.title,
        );

      if (!question) {
        return false;
      }

      return content === question;
    },
  );
}

function normalizeClarificationText(
  value: unknown,
): string {
  return String(value ?? '')
    .replace(
      /\r\n?/g,
      '\n',
    )
    /*
     * Ignore lightweight Markdown decoration so
     * "**question**" and "question" are treated as
     * the same rendered clarification.
     */
    .replace(
      /\[([^\]]+)]\([^)]*\)/g,
      '$1',
    )
    .replace(
      /(^|\s)[#>*_~`]+(?=\s|$)/g,
      '$1',
    )
    .replace(
      /[*_~`]+/g,
      '',
    )
    .replace(
      /\s+/g,
      ' ',
    )
    .trim();
}

function findActiveImageGenerationActivity(
  runtimeActivities:
    ImageGenerationActivity[],
): ImageGenerationActivity | null {
  const activities =
    imageGenerationActivities(
      runtimeActivities,
    );

  for (
    let index =
      activities.length - 1;
    index >= 0;
    index -= 1
  ) {
    const activity =
      activities[index];

    if (
      isActiveImageGenerationStatus(
        activity.status,
      )
    ) {
      return activity;
    }
  }

  return null;
}

function isActiveImageGenerationStatus(
  status: string,
): boolean {
  return status === 'queued'
    || status === 'running'
    || status === 'waiting'
    || status === 'blocked'
    || status === 'partial';
}

function resolvePendingImageMedia(
  activity:
    ImageGenerationActivity
    | null,
  images: ChatObjectCard[],
): ChatObjectCard['media'] | undefined {
  if (activity) {
    const activeBatchId =
      imageGenerationBatchId(
        activity,
      );

    const matchingImage =
      [...images]
        .reverse()
        .find((image) => (
          String(
            image.generationBatchId
              ?? '',
          ).trim()
          === activeBatchId
          && hasValidImageMedia(
            image.media,
          )
        ));

    if (matchingImage?.media) {
      return {
        width:
          matchingImage.media.width,
        height:
          matchingImage.media.height,
      };
    }

    const requestedMedia =
      imageGenerationRequestMedia(
        activity,
      );

    if (requestedMedia) {
      return requestedMedia;
    }
  }

  const lastImage =
    [...images]
      .reverse()
      .find((image) =>
        hasValidImageMedia(
          image.media,
        ),
      );

  if (lastImage?.media) {
    return {
      width:
        lastImage.media.width,
      height:
        lastImage.media.height,
    };
  }

  return activity
    ? {
        width: 1,
        height: 1,
      }
    : undefined;
}

function imageGenerationRequestMedia(
  activity: ImageGenerationActivity,
): ChatObjectCard['media'] | undefined {
  const detail =
    asRecord(activity.detail);

  const candidates = [
    asRecord(detail.input),
    asRecord(detail.arguments),
    asRecord(detail.args),
    asRecord(detail.parameters),
    asRecord(detail.request),
    asRecord(detail.toolInput),
    detail,
  ];

  for (const candidate of candidates) {
    const directDimensions =
      dimensionsFromRecord(
        candidate,
      );

    if (directDimensions) {
      return directDimensions;
    }

    const mediaDimensions =
      dimensionsFromRecord(
        asRecord(
          candidate.media,
        ),
      );

    if (mediaDimensions) {
      return mediaDimensions;
    }

    const sizeDimensions =
      dimensionsFromRecord(
        asRecord(
          candidate.size,
        ),
      );

    if (sizeDimensions) {
      return sizeDimensions;
    }

    const parsedSize =
      parseImageSize(
        candidate.size,
      );

    if (parsedSize) {
      return parsedSize;
    }

    const parsedRatio =
      parseImageRatio(
        candidate.aspectRatio
        ?? candidate.ratio,
      );

    if (parsedRatio) {
      return parsedRatio;
    }
  }

  return undefined;
}

function dimensionsFromRecord(
  value: Record<string, unknown>,
): {
  width: number;
  height: number;
} | null {
  const width =
    finitePositiveNumber(
      value.width,
    );

  const height =
    finitePositiveNumber(
      value.height,
    );

  if (!width || !height) {
    return null;
  }

  return {
    width,
    height,
  };
}

function parseImageSize(
  value: unknown,
): {
  width: number;
  height: number;
} | null {
  const normalized =
    text(value)
      .toLowerCase()
      .replace('×', 'x');

  if (!normalized) {
    return null;
  }

  const parts =
    normalized.split('x');

  if (parts.length !== 2) {
    return null;
  }

  const width =
    finitePositiveNumber(
      parts[0],
    );

  const height =
    finitePositiveNumber(
      parts[1],
    );

  if (!width || !height) {
    return null;
  }

  return {
    width,
    height,
  };
}

function parseImageRatio(
  value: unknown,
): {
  width: number;
  height: number;
} | null {
  const directRatio =
    finitePositiveNumber(value);

  if (directRatio) {
    return {
      width: directRatio,
      height: 1,
    };
  }

  const normalized =
    text(value)
      .replace('/', ':');

  if (!normalized) {
    return null;
  }

  const parts =
    normalized.split(':');

  if (parts.length !== 2) {
    return null;
  }

  const width =
    finitePositiveNumber(
      parts[0],
    );

  const height =
    finitePositiveNumber(
      parts[1],
    );

  if (!width || !height) {
    return null;
  }

  return {
    width,
    height,
  };
}

function hasValidImageMedia(
  media:
    ChatObjectCard['media']
    | undefined,
): boolean {
  return (
    finitePositiveNumber(
      media?.width,
    ) != null
    && finitePositiveNumber(
      media?.height,
    ) != null
  );
}

function imageGenerationBatchId(
  activity:
    ImageGenerationActivity,
): string {
  const detail =
    asRecord(activity.detail);

  return text(
    detail.toolCallId,
  )
    || activity.activityId.replace(
      /^tool_/,
      '',
    );
}

function collectRuntimeActivities(
  runtimeDisplay:
    RuntimeDisplayProjection
    | null,
  items: AssistantTimelineItem[],
): ImageGenerationActivity[] {
  const candidates:
    ImageGenerationActivity[] = [];

  if (runtimeDisplay) {
    for (
      const events
      of Object.values(
        runtimeDisplay.pendingByStepId,
      )
    ) {
      for (const event of events) {
        if (
          event.type
          === 'assistant.timeline.activity'
        ) {
          candidates.push(
            event.activity,
          );
        }
      }
    }

    for (
      const event
      of runtimeDisplay.unattached
    ) {
      if (
        event.type
        === 'assistant.timeline.activity'
      ) {
        candidates.push(
          event.activity,
        );
      }
    }
  }

  for (const item of items) {
    if (
      item.type
      !== 'execution-group'
    ) {
      continue;
    }

    candidates.push(
      ...item.activities,
    );
  }

  const latestByActivityId =
    new Map<
      string,
      ImageGenerationActivity
    >();

  for (const activity of candidates) {
    const current =
      latestByActivityId.get(
        activity.activityId,
      );

    if (
      !current
      || activity.version
        > current.version
      || (
        activity.version
          === current.version
        && activity.sequence
          >= current.sequence
      )
    ) {
      latestByActivityId.set(
        activity.activityId,
        activity,
      );
    }
  }

  return [
    ...latestByActivityId.values(),
  ].sort(
    (left, right) =>
      left.sequence
      - right.sequence
      || left.activityId.localeCompare(
        right.activityId,
      ),
  );
}

function imageGenerationActivities(
  activities:
    ImageGenerationActivity[],
): ImageGenerationActivity[] {
  return activities.filter(
    (activity) =>
      activity.kind === 'tool'
      && activity.operation
        .trim()
        .toLowerCase()
        === 'image.generate',
  );
}

function finitePositiveNumber(
  value: unknown,
): number | null {
  const number = Number(value);

  return Number.isFinite(number)
    && number > 0
      ? number
      : null;
}

function asRecord(
  value: unknown,
): Record<string, unknown> {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
      ? value as Record<
          string,
          unknown
        >
      : {};
}

function text(
  value: unknown,
): string {
  return typeof value === 'string'
    ? value.trim()
    : '';
}