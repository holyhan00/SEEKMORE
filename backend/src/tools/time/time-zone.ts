import { normalizeTimeZone } from '../../modules/localization/locale-normalizer';
export { normalizeTimeZone } from '../../modules/localization/locale-normalizer';

const EXPLICIT_OFFSET_PATTERN = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/;

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export function parseDateTimeInZone(
  value: string,
  timeZone: string,
): Date | null {
  const text = value.trim();

  if (!text) {
    return null;
  }

  if (EXPLICIT_OFFSET_PATTERN.test(text)) {
    return validDate(text);
  }

  const match = LOCAL_DATE_TIME_PATTERN.exec(text);

  if (!match) {
    return validDate(text);
  }

  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond: Number(
      String(match[7] ?? '')
        .slice(0, 3)
        .padEnd(3, '0') || 0,
    ),
  };

  if (!validLocalParts(parts)) {
    return null;
  }

  const normalizedTimeZone = normalizeTimeZone(timeZone);

  if (!normalizedTimeZone) {
    return null;
  }

  const desiredLocalEpoch = localPartsAsUtc(parts);
  let candidateEpoch = desiredLocalEpoch;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actualParts = localPartsAt(
      new Date(candidateEpoch),
      normalizedTimeZone,
    );

    const delta = desiredLocalEpoch
      - localPartsAsUtc({
        ...actualParts,
        millisecond: parts.millisecond,
      });

    if (delta === 0) {
      break;
    }

    candidateEpoch += delta;
  }

  const candidate = new Date(candidateEpoch);
  const resolvedParts = localPartsAt(
    candidate,
    normalizedTimeZone,
  );

  if (!sameLocalParts(parts, resolvedParts)) {
    return null;
  }

  return candidate;
}

export function formatLocalDateTime(
  date: Date,
  timeZone: string,
): string {
  const normalizedTimeZone =
    normalizeTimeZone(timeZone) ?? 'UTC';

  const parts = localPartsAt(date, normalizedTimeZone);

  return [
    `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`,
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`,
  ].join('T');
}

export function getTimeZoneOffsetMinutes(
  date: Date,
  timeZone: string,
): number {
  const normalizedTimeZone =
    normalizeTimeZone(timeZone) ?? 'UTC';

  const parts = localPartsAt(date, normalizedTimeZone);
  const localEpoch = localPartsAsUtc({
    ...parts,
    millisecond: date.getUTCMilliseconds(),
  });

  return Math.round(
    (localEpoch - date.getTime()) / 60_000,
  );
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date
    : null;
}

function validLocalParts(
  parts: LocalDateTimeParts,
): boolean {
  if (
    parts.month < 1
    || parts.month > 12
    || parts.day < 1
    || parts.day > 31
    || parts.hour < 0
    || parts.hour > 23
    || parts.minute < 0
    || parts.minute > 59
    || parts.second < 0
    || parts.second > 59
    || parts.millisecond < 0
    || parts.millisecond > 999
  ) {
    return false;
  }

  const normalized = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );

  return (
    normalized.getUTCFullYear() === parts.year
    && normalized.getUTCMonth() + 1 === parts.month
    && normalized.getUTCDate() === parts.day
    && normalized.getUTCHours() === parts.hour
    && normalized.getUTCMinutes() === parts.minute
    && normalized.getUTCSeconds() === parts.second
    && normalized.getUTCMilliseconds()
      === parts.millisecond
  );
}

function localPartsAt(
  date: Date,
  timeZone: string,
): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const values = new Map(
    formatter
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    second: Number(values.get('second')),
    millisecond: date.getUTCMilliseconds(),
  };
}

function localPartsAsUtc(
  parts: LocalDateTimeParts,
): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function sameLocalParts(
  left: LocalDateTimeParts,
  right: LocalDateTimeParts,
): boolean {
  return (
    left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second
    && left.millisecond === right.millisecond
  );
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}
