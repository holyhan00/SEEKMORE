import type {
  RuntimeActivity,
  RuntimeActivityEvent,
  RuntimeContentEvent,
  RuntimeEvent,
  RuntimeReasoningSummaryEvent,
  RuntimeStepEvent,
} from '../events/runtime-events.types';
import type {
  AssistantActivitySegment,
  AssistantExecutionGroup,
  AssistantTextSegment,
  AssistantTimelineItem,
  PendingRuntimeActivityView,
  RuntimeDisplayProjection,
  RuntimeDisplayReasoningSummary,
} from './runtime-display.types';

export function emptyRuntimeDisplayProjection(): RuntimeDisplayProjection {
  return {
    groupsById: {},
    groupIds: [],
    surfacesById: {},
    surfaceIds: [],
    pendingByStepId: {},
    unattached: [],
    items: [],
    pendingActivityById: {},
    latestPendingActivityTitle: null,
    latestPendingActivity: null,
  };
}

export function projectRuntimeDisplayEvent(
  state: RuntimeDisplayProjection,
  event: RuntimeEvent,
): RuntimeDisplayProjection {
  if (event.type === 'assistant.timeline.step') {
    return projectStep(state, event);
  }

  if (event.type === 'assistant.timeline.content') {
    return projectContent(state, event);
  }

  if (
    event.type
    === 'assistant.timeline.reasoning_summary'
  ) {
    return projectReasoning(state, event);
  }

  return projectActivity(state, event);
}

function projectStep(
  state: RuntimeDisplayProjection,
  event: RuntimeStepEvent,
): RuntimeDisplayProjection {
  const stepId = event.step.stepId;
  const current = state.groupsById[stepId];
  const group = summarizeGroup({
    segmentId: `group:${stepId}`,
    type: 'execution-group',
    sequence: current
      ? Math.min(current.sequence, event.sequence)
      : event.sequence,
    step: event.step,
    summary: current?.summary ?? '',
    commentary: current?.commentary ?? [],
    reasoning: current?.reasoning ?? [],
    activities: current?.activities ?? [],
    timing: event.step.timing ?? null,
  });

  let next = setGroup(state, group);
  const pending = next.pendingByStepId[stepId] ?? [];

  if (pending.length > 0) {
    const pendingByStepId = {
      ...next.pendingByStepId,
    };
    delete pendingByStepId[stepId];
    next = {
      ...next,
      pendingByStepId,
    };

    for (const pendingEvent of pending) {
      next = projectRuntimeDisplayEvent(
        next,
        pendingEvent,
      );
    }
  }

  if (
    !current
    && next.unattached.length > 0
  ) {
    const unattached = next.unattached;
    next = {
      ...next,
      unattached: [],
    };

    for (const pendingEvent of unattached) {
      next = projectRuntimeDisplayEvent(
        next,
        pendingEvent,
      );
    }
  }

  return next;
}

function projectContent(
  state: RuntimeDisplayProjection,
  event: RuntimeContentEvent,
): RuntimeDisplayProjection {
  if (event.block.role === 'final') {
    return setSurface(state, {
      segmentId:
        `content:${event.block.blockId}`,
      type: 'text',
      sequence: event.sequence,
      markdown: event.block.markdown,
      role: 'final',
      final: event.block.final,
    });
  }

  const ownerStepId =
    event.block.stepId
    || nearestStepId(
      state,
      event.sequence,
    );

  if (!ownerStepId) {
    return queueUnattached(state, event);
  }

  const group = state.groupsById[ownerStepId];

  if (!group) {
    return queueForStep(
      state,
      ownerStepId,
      event,
    );
  }

  const segment: AssistantTextSegment = {
    segmentId:
      `content:${event.block.blockId}`,
    type: 'text',
    sequence: event.sequence,
    markdown: event.block.markdown,
    role: 'commentary',
    final: event.block.final,
  };

  return setGroup(
    state,
    summarizeGroup({
      ...group,
      sequence: Math.min(
        group.sequence,
        event.sequence,
      ),
      commentary: upsertOrdered(
        group.commentary,
        segment,
        (value) => value.segmentId,
        (value) => value.sequence,
      ),
    }),
  );
}

function projectReasoning(
  state: RuntimeDisplayProjection,
  event: RuntimeReasoningSummaryEvent,
): RuntimeDisplayProjection {
  const stepId = event.summary.stepId;
  const group = state.groupsById[stepId];

  if (!group) {
    return queueForStep(
      state,
      stepId,
      event,
    );
  }

  const summary: RuntimeDisplayReasoningSummary = {
    ...event.summary,
    sequence: event.sequence,
  };

  return setGroup(
    state,
    summarizeGroup({
      ...group,
      sequence: Math.min(
        group.sequence,
        event.sequence,
      ),
      reasoning: upsertOrdered(
        group.reasoning,
        summary,
        (value) => value.summaryId,
        (value) => value.sequence,
      ),
    }),
  );
}

function projectActivity(
  state: RuntimeDisplayProjection,
  event: RuntimeActivityEvent,
): RuntimeDisplayProjection {
  const pendingState = updatePendingActivity(
    state,
    event.activity,
  );

  if (isInteractiveActivity(event.activity.kind)) {
    const segment: AssistantActivitySegment = {
      segmentId:
        `activity:${event.activity.activityId}`,
      type: 'activity',
      sequence: event.sequence,
      activity: event.activity,
    };

    return setSurface(
      pendingState,
      segment,
    );
  }

  const ownerStepId =
    event.activity.stepId
    || nearestStepId(
      pendingState,
      event.sequence,
    );

  if (!ownerStepId) {
    return event.activity.kind === 'phase'
      ? pendingState
      : queueUnattached(
          pendingState,
          event,
        );
  }

  const group =
    pendingState.groupsById[ownerStepId];

  if (!group) {
    return queueForStep(
      pendingState,
      ownerStepId,
      event,
    );
  }

  return setGroup(
    pendingState,
    summarizeGroup({
      ...group,
      sequence: Math.min(
        group.sequence,
        event.sequence,
      ),
      activities: upsertOrdered(
        group.activities,
        event.activity,
        (value) => value.activityId,
        (value) => value.sequence,
      ),
    }),
  );
}

function setGroup(
  state: RuntimeDisplayProjection,
  group: AssistantExecutionGroup,
): RuntimeDisplayProjection {
  const stepId = group.step.stepId;
  const exists = Boolean(
    state.groupsById[stepId],
  );
  const groupsById = {
    ...state.groupsById,
    [stepId]: group,
  };
  const groupIds = upsertOrderedId(
    state.groupIds,
    stepId,
    (left, right) =>
      compareGroups(
        groupsById[left],
        groupsById[right],
      ),
    exists,
  );

  return {
    ...state,
    groupsById,
    groupIds,
    items: upsertTimelineItem(
      state.items,
      group,
    ),
  };
}

function setSurface(
  state: RuntimeDisplayProjection,
  surface:
    | AssistantTextSegment
    | AssistantActivitySegment,
): RuntimeDisplayProjection {
  const segmentId = surface.segmentId;
  const exists = Boolean(
    state.surfacesById[segmentId],
  );
  const surfacesById = {
    ...state.surfacesById,
    [segmentId]: surface,
  };
  const surfaceIds = upsertOrderedId(
    state.surfaceIds,
    segmentId,
    (left, right) =>
      compareItems(
        surfacesById[left],
        surfacesById[right],
      ),
    exists,
  );

  return {
    ...state,
    surfacesById,
    surfaceIds,
    items: upsertTimelineItem(
      state.items,
      surface,
    ),
  };
}

function queueForStep(
  state: RuntimeDisplayProjection,
  stepId: string,
  event: RuntimeEvent,
): RuntimeDisplayProjection {
  const current =
    state.pendingByStepId[stepId]
    ?? [];

  return {
    ...state,
    pendingByStepId: {
      ...state.pendingByStepId,
      [stepId]: upsertEvent(
        current,
        event,
      ),
    },
  };
}

function queueUnattached(
  state: RuntimeDisplayProjection,
  event: RuntimeEvent,
): RuntimeDisplayProjection {
  return {
    ...state,
    unattached: upsertEvent(
      state.unattached,
      event,
    ),
  };
}

function updatePendingActivity(
  state: RuntimeDisplayProjection,
  activity: RuntimeActivity,
): RuntimeDisplayProjection {
  const pending =
    activity.status === 'running'
    || activity.status === 'queued';
  const current =
    state.pendingActivityById[
      activity.activityId
    ];

  if (
    pending
    && current?.sequence === activity.sequence
    && current.title === activity.title
  ) {
    return state;
  }

  if (!pending && !current) {
    return state;
  }

  const pendingActivityById = {
    ...state.pendingActivityById,
  };

  if (pending) {
    pendingActivityById[
      activity.activityId
    ] = {
      sequence: activity.sequence,
      title: activity.title,
      presentation: activity.presentation ?? null,
    };
  } else {
    delete pendingActivityById[
      activity.activityId
    ];
  }

  return {
    ...state,
    pendingActivityById,
    latestPendingActivityTitle:
      latestPendingTitle(
        pendingActivityById,
      ),
    latestPendingActivity:
      latestPendingActivity(
        pendingActivityById,
      ),
  };
}

function summarizeGroup(
  group: AssistantExecutionGroup,
): AssistantExecutionGroup {
  const commentary = latestText(
    group.commentary.map(
      (item) => ({
        sequence: item.sequence,
        text: compactText(
          item.markdown,
        ),
      }),
    ),
  );

  if (commentary) {
    return {
      ...group,
      summary: commentary,
    };
  }

  const reasoning = latestText(
    group.reasoning.map(
      (item) => ({
        sequence: item.sequence,
        text: compactText(
          item.markdown,
        ),
      }),
    ),
  );

  if (reasoning) {
    return {
      ...group,
      summary: reasoning,
    };
  }

  const activity = latestText(
    group.activities
      .filter(
        (item) => item.kind !== 'phase',
      )
      .map((item) => ({
        sequence: item.sequence,
        text: compactText(
          item.summary
          || item.title,
        ),
      })),
  );

  return {
    ...group,
    summary:
      activity
      || compactText(
        group.step.title
        ?? '',
      )
      || '',
  };
}

function nearestStepId(
  state: RuntimeDisplayProjection,
  sequence: number,
): string | null {
  if (state.groupIds.length === 0) {
    return null;
  }

  let preceding: string | null = null;

  for (const stepId of state.groupIds) {
    const group = state.groupsById[stepId];

    if (group.sequence > sequence) {
      break;
    }

    preceding = stepId;
  }

  return preceding
    ?? state.groupIds[0]
    ?? null;
}

function upsertEvent(
  values: RuntimeEvent[],
  incoming: RuntimeEvent,
): RuntimeEvent[] {
  const index = values.findIndex(
    (event) => event.eventId === incoming.eventId,
  );
  const next = [...values];

  if (index < 0) {
    next.push(incoming);
  } else {
    next[index] = incoming;
  }

  return next.sort(
    (left, right) =>
      left.sequence - right.sequence
      || left.eventId.localeCompare(
        right.eventId,
      ),
  );
}

function upsertOrdered<T>(
  values: T[],
  incoming: T,
  idOf: (value: T) => string,
  sequenceOf: (value: T) => number,
): T[] {
  const incomingId = idOf(incoming);
  const index = values.findIndex(
    (value) => idOf(value) === incomingId,
  );
  const next = [...values];

  if (index < 0) {
    next.push(incoming);
  } else {
    next[index] = incoming;
  }

  return next.sort(
    (left, right) =>
      sequenceOf(left)
      - sequenceOf(right)
      || idOf(left).localeCompare(
        idOf(right),
      ),
  );
}

function upsertOrderedId(
  values: string[],
  incoming: string,
  compare: (left: string, right: string) => number,
  exists: boolean,
): string[] {
  const next = exists
    ? values.filter(
        (value) => value !== incoming,
      )
    : [...values];

  next.push(incoming);
  next.sort(compare);
  return next;
}

function upsertTimelineItem(
  values: AssistantTimelineItem[],
  incoming: AssistantTimelineItem,
): AssistantTimelineItem[] {
  const next = values.filter(
    (value) =>
      value.segmentId
      !== incoming.segmentId,
  );
  let low = 0;
  let high = next.length;

  while (low < high) {
    const middle = Math.floor(
      (low + high) / 2,
    );

    if (
      compareItems(
        next[middle],
        incoming,
      ) <= 0
    ) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  next.splice(low, 0, incoming);
  return next;
}

function compareGroups(
  left: AssistantExecutionGroup,
  right: AssistantExecutionGroup,
): number {
  return (
    (left.step.iteration
      ?? Number.MAX_SAFE_INTEGER)
    - (right.step.iteration
      ?? Number.MAX_SAFE_INTEGER)
  ) || (
    left.sequence
    - right.sequence
  ) || left.segmentId.localeCompare(
    right.segmentId,
  );
}

function compareItems(
  left: AssistantTimelineItem,
  right: AssistantTimelineItem,
): number {
  return left.sequence - right.sequence
    || left.segmentId.localeCompare(
      right.segmentId,
    );
}

function latestPendingActivity(
  values: Record<
    string,
    PendingRuntimeActivityView
  >,
): PendingRuntimeActivityView | null {
  let latest: PendingRuntimeActivityView | null = null;

  for (const value of Object.values(values)) {
    if (
      !latest
      || value.sequence >= latest.sequence
    ) {
      latest = value;
    }
  }

  return latest;
}

function latestPendingTitle(
  values: Record<string, PendingRuntimeActivityView>,
): string | null {
  return latestPendingActivity(values)?.title ?? null;
}

function latestText(
  values: Array<{
    sequence: number;
    text: string;
  }>,
): string {
  let latest = '';
  let latestSequence =
    Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (
      value.text
      && value.sequence
        >= latestSequence
    ) {
      latest = value.text;
      latestSequence =
        value.sequence;
    }
  }

  return latest;
}

function isInteractiveActivity(
  kind: string,
): boolean {
  return kind === 'approval'
    || kind === 'clarification';
}

function compactText(value: string): string {
  const text = String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(
      /[`*_>#\[\]()~-]+/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.length > 160
    ? `${text.slice(0, 157)}…`
    : text;
}
