import { localization } from './localization';

type RecordLike = Record<string, unknown>;

export function localizeApiError(
  error: unknown,
  fallbackKey = 'errors.requestFailed',
): string {
  const root = record(error);
  const response = record(root.response);
  const data = record(response.data);
  const params = record(data.params);
  const messages = textList(data.message);
  const message = text(data.message) || messages[0] || text(root.message);
  const code = text(data.code)
    || messages.find(isStableCode)
    || (isStableCode(message) ? message : '');

  if (code) {
    const key = `errors.${code}`;
    const translated = String(localization.t(key, {
      ...params,
      defaultValue: '',
    })).trim();
    if (translated) return translated;
  }

  if (message && !isStableCode(message)) return message;

  return String(localization.t(fallbackKey, {
    defaultValue: String(localization.t('errors.requestFailed')),
  }));
}

function isStableCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(value);
}

function record(value: unknown): RecordLike {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordLike
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : [];
}
