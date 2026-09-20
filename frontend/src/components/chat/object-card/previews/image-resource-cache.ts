import { authFetch } from '../../../../lib/http';

const MAX_CACHE_ENTRIES = 48;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

type ImageResourceEntry = {
  key: string;
  sourceUrl: string;
  objectUrl: string | null;
  bytes: number;
  consumers: number;
  lastUsedAt: number;
  promise: Promise<ImageResourceEntry>;
};

export type AcquiredImageResource = {
  url: string;
  release: () => void;
};

const entries = new Map<string, ImageResourceEntry>();
let cachedBytes = 0;

export async function acquireAuthenticatedImage(
  key: string,
  sourceUrl: string,
): Promise<AcquiredImageResource> {
  const cacheKey = String(key || sourceUrl).trim();
  const url = String(sourceUrl).trim();

  if (!cacheKey || !url) {
    throw new Error('IMAGE_RESOURCE_INVALID');
  }

  let entry = entries.get(cacheKey);

  if (entry && entry.sourceUrl !== url) {
    removeEntry(entry);
    entry = undefined;
  }

  if (!entry) {
    const created = createEntry(cacheKey, url);
    entries.set(cacheKey, created);
    entry = created;
  }

  entry.consumers += 1;
  entry.lastUsedAt = Date.now();

  try {
    const ready = await entry.promise;
    let released = false;

    return {
      url: ready.objectUrl || '',
      release: () => {
        if (released) return;
        released = true;
        releaseEntry(ready);
      },
    };
  } catch (error) {
    releaseEntry(entry);
    throw error;
  }
}

export function clearImageResourceCache(): void {
  for (const entry of entries.values()) {
    revokeEntryUrl(entry);
  }

  entries.clear();
  cachedBytes = 0;
}

function createEntry(
  key: string,
  sourceUrl: string,
): ImageResourceEntry {
  const entry = {
    key,
    sourceUrl,
    objectUrl: null,
    bytes: 0,
    consumers: 0,
    lastUsedAt: Date.now(),
    promise: Promise.resolve(null as unknown as ImageResourceEntry),
  } satisfies ImageResourceEntry;

  entry.promise = loadEntry(entry);
  return entry;
}

async function loadEntry(
  entry: ImageResourceEntry,
): Promise<ImageResourceEntry> {
  try {
    const response = await authFetch(entry.sourceUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`IMAGE_LOAD_FAILED:${response.status}`);
    }

    const blob = await response.blob();
    if (entries.get(entry.key) !== entry) {
      throw new Error('IMAGE_RESOURCE_RELEASED');
    }
    entry.objectUrl = URL.createObjectURL(blob);
    entry.bytes = blob.size;
    entry.lastUsedAt = Date.now();
    cachedBytes += blob.size;
    evictIdleEntries();
    return entry;
  } catch (error) {
    if (entries.get(entry.key) === entry) {
      entries.delete(entry.key);
    }
    revokeEntryUrl(entry);
    throw error;
  }
}

function releaseEntry(entry: ImageResourceEntry): void {
  entry.consumers = Math.max(0, entry.consumers - 1);
  entry.lastUsedAt = Date.now();
  evictIdleEntries();
}

function evictIdleEntries(): void {
  if (
    entries.size <= MAX_CACHE_ENTRIES
    && cachedBytes <= MAX_CACHE_BYTES
  ) {
    return;
  }

  const candidates = [...entries.values()]
    .filter((entry) => entry.consumers === 0 && Boolean(entry.objectUrl))
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

  for (const entry of candidates) {
    if (
      entries.size <= MAX_CACHE_ENTRIES
      && cachedBytes <= MAX_CACHE_BYTES
    ) {
      break;
    }

    removeEntry(entry);
  }
}

function removeEntry(entry: ImageResourceEntry): void {
  if (entries.get(entry.key) === entry) {
    entries.delete(entry.key);
  }
  revokeEntryUrl(entry);
}

function revokeEntryUrl(entry: ImageResourceEntry): void {
  if (!entry.objectUrl) return;

  URL.revokeObjectURL(entry.objectUrl);
  cachedBytes = Math.max(0, cachedBytes - entry.bytes);
  entry.objectUrl = null;
  entry.bytes = 0;
}

