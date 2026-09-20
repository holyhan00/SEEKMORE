import { useMemo } from 'react';
import { useLocalization } from './LocalizationProvider';

export function useFormatter() {
  const { snapshot } = useLocalization();

  return useMemo(() => ({
    formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions) {
      return new Intl.DateTimeFormat(snapshot.formatLocale, {
        timeZone: snapshot.timeZone,
        ...(options ?? { dateStyle: 'medium' }),
      }).format(toDate(value));
    },
    formatTime(value: Date | number | string, options?: Intl.DateTimeFormatOptions) {
      return new Intl.DateTimeFormat(snapshot.formatLocale, {
        timeZone: snapshot.timeZone,
        ...(options ?? { timeStyle: 'short' }),
      }).format(toDate(value));
    },
    formatDateTime(value: Date | number | string, options?: Intl.DateTimeFormatOptions) {
      return new Intl.DateTimeFormat(snapshot.formatLocale, {
        timeZone: snapshot.timeZone,
        ...(options ?? {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      }).format(toDate(value));
    },
    formatNumber(value: number, options?: Intl.NumberFormatOptions) {
      return new Intl.NumberFormat(snapshot.formatLocale, options).format(value);
    },
    formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit) {
      return new Intl.RelativeTimeFormat(snapshot.formatLocale, { numeric: 'auto' })
        .format(value, unit);
    },
  }), [snapshot.formatLocale, snapshot.timeZone]);
}

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}
