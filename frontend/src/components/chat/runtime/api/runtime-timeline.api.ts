import { api } from '../../../../lib/api';
import type { RuntimeEvent } from '../events/runtime-events.types';

export async function getRuntimeTimeline(
  conversationId: string,
  afterSequence?: string | null,
): Promise<{
  events: RuntimeEvent[];
  nextCursor: string | null;
}> {
  if (!afterSequence) {
    const response = await api.get(
      `/chat/${encodeURIComponent(conversationId)}/runtime-timeline`,
      { params: { mode: 'snapshot' } },
    );
    return normalizeResponse(response.data?.data, null);
  }

  const events: RuntimeEvent[] = [];
  let cursor: string | null = afterSequence;

                                       
  for (let page = 0; page < 20; page += 1) {
    const response = await api.get(
      `/chat/${encodeURIComponent(conversationId)}/runtime-timeline`,
      {
        params: {
          afterSequence: cursor,
          limit: 1000,
        },
      },
    );
    const data = response.data?.data ?? {};
    const normalized = normalizeResponse(data, cursor);
    events.push(...normalized.events);
    cursor = normalized.nextCursor;

    if (data.hasMore !== true || normalized.events.length === 0) {
      break;
    }
  }

  return { events, nextCursor: cursor };
}

function normalizeResponse(
  value: unknown,
  fallbackCursor: string | null,
): { events: RuntimeEvent[]; nextCursor: string | null } {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    events: Array.isArray(data.events)
      ? (data.events as RuntimeEvent[])
      : [],
    nextCursor:
      typeof data.nextCursor === 'string'
        ? data.nextCursor
        : fallbackCursor,
  };
}
