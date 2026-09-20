import {
  FRONTEND_RUNTIME_CONFIG,
} from '../runtime-config';

function backendBaseUrl(): string {
  return FRONTEND_RUNTIME_CONFIG
    .backendOrigin
    .replace(/\/+$/, '');
}

export function resolveRuntimeObjectUrl(
  value?: string,
): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  if (
    raw.startsWith('blob:')
    || raw.startsWith('data:')
  ) {
    return raw;
  }

  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);

    if (
      parsed.pathname.startsWith(
        '/objects/',
      )
    ) {
      parsed.pathname =
        `/api${parsed.pathname}`;
    }

    return parsed.toString();
  }

  const base = backendBaseUrl();

  if (raw.startsWith('/api/objects/')) {
    return `${base}${raw}`;
  }

  if (raw.startsWith('api/objects/')) {
    return `${base}/${raw}`;
  }

  if (raw.startsWith('/objects/')) {
    return `${base}/api${raw}`;
  }

  if (raw.startsWith('objects/')) {
    return `${base}/api/${raw}`;
  }

  if (raw.startsWith('/api/')) {
    return `${base}${raw}`;
  }

  return `${base}/${raw.replace(/^\/+/, '')}`;
}
