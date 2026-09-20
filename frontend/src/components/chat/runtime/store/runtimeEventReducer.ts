import {
  normalizeRuntimeEvent,
  type RuntimeEvent,
} from '../events/runtime-events.types';
import {
  emptyRuntimeDisplayProjection,
  projectRuntimeDisplayEvent,
} from '../display/runtime-display.projector';
import type { RuntimeTimelineState } from './runtimeEventState';
import { emptyRuntimeTimelineState } from './runtimeEventState';

const MAX_SEEN_EVENT_IDS = 20_000;
const SEEN_EVENT_BUCKET_SIZE = 512;
const MAX_SEEN_EVENT_BUCKETS = Math.ceil(
  MAX_SEEN_EVENT_IDS
  / SEEN_EVENT_BUCKET_SIZE,
);

export function reduceRuntimeEvents(
  values: unknown[],
  conversationId: string,
  nextCursor: string | null = null,
): RuntimeTimelineState {
  const events = values
    .map(normalizeRuntimeEvent)
    .filter(
      (event): event is RuntimeEvent =>
        Boolean(
          event
          && event.conversationId
            === conversationId,
        ),
    )
    .sort(
      (left, right) =>
        left.sequence
        - right.sequence
        || left.eventId.localeCompare(
          right.eventId,
        ),
    );

  let state = emptyRuntimeTimelineState();

  for (const event of events) {
    state = upsertRuntimeEvent(
      state,
      event,
    );
  }

  if (nextCursor) {
    state = {
      ...state,
      lastReplayCursor: maxCursor(
        state.lastReplayCursor,
        nextCursor,
      ),
    };
  }

  return state;
}

export function mergeRuntimeTimelineStates(
  snapshot: RuntimeTimelineState,
  incremental: RuntimeTimelineState,
  baseline?: RuntimeTimelineState,
): RuntimeTimelineState {
  let merged = snapshot;

  if (baseline) {
    for (const event of runtimeEventsFromState(baseline)) {
      if (hasSeenRuntimeEvent(merged, event.eventId)) {
        continue;
      }

      merged = upsertRuntimeEvent(
        merged,
        event,
      );
    }
  }

  for (const event of runtimeEventsFromState(incremental)) {
    if (
      baseline
      && hasSeenRuntimeEvent(
        baseline,
        event.eventId,
      )
    ) {
      continue;
    }

    merged = upsertRuntimeEvent(
      merged,
      event,
    );
  }

  return {
    ...merged,
    lastReplayCursor: maxCursor(
      snapshot.lastReplayCursor,
      maxCursor(
        baseline?.lastReplayCursor
        ?? null,
        incremental.lastReplayCursor,
      ),
    ),
  };
}

export function upsertRuntimeEvent(
  state: RuntimeTimelineState,
  incoming: RuntimeEvent,
): RuntimeTimelineState {
  if (hasSeenRuntimeEvent(state, incoming.eventId)) {
    return incoming.replayCursor
      && incoming.replayCursor
        !== state.lastReplayCursor
      ? {
          ...state,
          lastReplayCursor: maxCursor(
            state.lastReplayCursor,
            incoming.replayCursor,
          ),
        }
      : state;
  }

  let storedEvent: RuntimeEvent = incoming;
  let next: RuntimeTimelineState = {
    ...state,
    seenEventIdBuckets:
      appendSeenEventId(
        state.seenEventIdBuckets,
        incoming.eventId,
      ),
    lastReplayCursor: maxCursor(
      state.lastReplayCursor,
      incoming.replayCursor
      ?? null,
    ),
  };

  if (incoming.type === 'assistant.timeline.content') {
    storedEvent = preserve(
      state.contentById[
        incoming.block.blockId
      ],
      incoming,
    );
    next = {
      ...next,
      contentById: {
        ...state.contentById,
        [incoming.block.blockId]:
          storedEvent,
      },
    };
  } else if (incoming.type === 'assistant.timeline.step') {
    storedEvent = preserve(
      state.stepsById[
        incoming.step.stepId
      ],
      incoming,
    );
    next = {
      ...next,
      stepsById: {
        ...state.stepsById,
        [incoming.step.stepId]:
          storedEvent,
      },
    };

    if (incoming.step.timing) {
      next = {
        ...next,
        timingByMessageId: {
          ...state.timingByMessageId,
          [incoming.assistantMessageId]:
            incoming.step.timing,
        },
      };
    }
  } else if (
    incoming.type
    === 'assistant.timeline.reasoning_summary'
  ) {
    storedEvent = preserve(
      state.reasoningById[
        incoming.summary.summaryId
      ],
      incoming,
    );
    next = {
      ...next,
      reasoningById: {
        ...state.reasoningById,
        [incoming.summary.summaryId]:
          storedEvent,
      },
    };
  } else {
    const current =
      state.activitiesById[
        incoming.activity.activityId
      ];

    if (
      current
      && incoming.activity.version
        < current.activity.version
    ) {
      return next;
    }

    storedEvent = preserve(
      current,
      incoming,
    );
    next = {
      ...next,
      activitiesById: {
        ...state.activitiesById,
        [incoming.activity.activityId]:
          storedEvent,
      },
    };
  }

  const assistantMessageId =
    storedEvent.assistantMessageId;
  const currentDisplay =
    state.displayByAssistantMessageId[
      assistantMessageId
    ]
    ?? emptyRuntimeDisplayProjection();
  const nextDisplay =
    projectRuntimeDisplayEvent(
      currentDisplay,
      storedEvent,
    );

  return {
    ...next,
    displayByAssistantMessageId: {
      ...state.displayByAssistantMessageId,
      [assistantMessageId]:
        nextDisplay,
    },
  };
}

function preserve<T extends RuntimeEvent>(
  current: T | undefined,
  incoming: T,
): T {
  return current
    ? {
        ...incoming,
        sequence: Math.min(
          current.sequence,
          incoming.sequence,
        ),
      }
    : incoming;
}

export function runtimeEventsFromState(
  state: RuntimeTimelineState,
): RuntimeEvent[] {
  return [
    ...Object.values(state.stepsById),
    ...Object.values(state.reasoningById),
    ...Object.values(state.activitiesById),
    ...Object.values(state.contentById),
  ].sort(
    (left, right) =>
      left.sequence - right.sequence
      || left.eventId.localeCompare(
        right.eventId,
      ),
  );
}

export function hasSeenRuntimeEvent(
  state: RuntimeTimelineState,
  eventId: string,
): boolean {
  for (
    let index =
      state.seenEventIdBuckets.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (
      state.seenEventIdBuckets[index][eventId]
      === true
    ) {
      return true;
    }
  }

  return false;
}

function appendSeenEventId(
  buckets: ReadonlyArray<
    Readonly<Record<string, true>>
  >,
  eventId: string,
): ReadonlyArray<
  Readonly<Record<string, true>>
> {
  const current =
    buckets[buckets.length - 1];

  if (
    !current
    || Object.keys(current).length
      >= SEEN_EVENT_BUCKET_SIZE
  ) {
    const next = [
      ...buckets,
      { [eventId]: true as const },
    ];

    return next.length
      <= MAX_SEEN_EVENT_BUCKETS
      ? next
      : next.slice(
          next.length
          - MAX_SEEN_EVENT_BUCKETS,
        );
  }

  const nextBucket = {
    ...current,
    [eventId]: true as const,
  };

  return [
    ...buckets.slice(0, -1),
    nextBucket,
  ];
}

function maxCursor(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) return right;
  if (!right) return left;

  try {
    return BigInt(right) > BigInt(left)
      ? right
      : left;
  } catch {
    return right;
  }
}
