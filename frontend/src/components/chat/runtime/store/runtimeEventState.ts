import { atomFamily } from 'recoil';
import type {
  RuntimeEvent,
  RuntimeExecutionTiming,
} from '../events/runtime-events.types';
import type {
  RuntimeDisplayProjection,
} from '../display/runtime-display.types';

export type RuntimeTimelineState = {
  contentById: Record<
    string,
    Extract<RuntimeEvent, { type: 'assistant.timeline.content' }>
  >;
  stepsById: Record<
    string,
    Extract<RuntimeEvent, { type: 'assistant.timeline.step' }>
  >;
  reasoningById: Record<
    string,
    Extract<RuntimeEvent, { type: 'assistant.timeline.reasoning_summary' }>
  >;
  activitiesById: Record<
    string,
    Extract<RuntimeEvent, { type: 'assistant.timeline.activity' }>
  >;
  timingByMessageId: Record<string, RuntimeExecutionTiming>;
  displayByAssistantMessageId: Record<
    string,
    RuntimeDisplayProjection
  >;
  seenEventIdBuckets: ReadonlyArray<
    Readonly<Record<string, true>>
  >;
  lastReplayCursor: string | null;
};

export const EMPTY_RUNTIME_TIMELINE: RuntimeTimelineState = {
  contentById: {},
  stepsById: {},
  reasoningById: {},
  activitiesById: {},
  timingByMessageId: {},
  displayByAssistantMessageId: {},
  seenEventIdBuckets: [],
  lastReplayCursor: null,
};

export const emptyRuntimeTimelineState = (): RuntimeTimelineState => ({
  contentById: {},
  stepsById: {},
  reasoningById: {},
  activitiesById: {},
  timingByMessageId: {},
  displayByAssistantMessageId: {},
  seenEventIdBuckets: [],
  lastReplayCursor: null,
});

export const runtimeEventListState = atomFamily<
  RuntimeTimelineState,
  string
>({
  key: 'runtimeEventListState',
  default: EMPTY_RUNTIME_TIMELINE,
});
