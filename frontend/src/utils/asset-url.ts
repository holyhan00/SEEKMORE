const BUILTIN_ASSET_PREFIX = 'builtin:';

const PUBLIC_ASSET_PREFIXES = [
  'avatars/',
  'backgrounds/',
  'banner/',
  'builtin/',
  'effects/',
  'icons/',
] as const;

export interface ResolveAssetUrlOptions {
  fallback?: string;
  size?: number;
  version?: number | string | Date | null;
}

function encodeAssetPath(
  value: string,
): string | null {
  const segments = value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);

  if (
    segments.length === 0
    || segments.some(
      (segment) =>
        segment === '.'
        || segment === '..',
    )
  ) {
    return null;
  }

  return segments
    .map((segment) =>
      encodeURIComponent(segment),
    )
    .join('/');
}

function appendAssetQuery(
  url: string,
  options?: ResolveAssetUrlOptions,
): string {
  const query: string[] = [];

  if (
    typeof options?.size === 'number'
    && Number.isFinite(options.size)
    && options.size > 0
  ) {
    query.push(
      `s=${encodeURIComponent(
        String(options.size),
      )}`,
    );
  }

  if (options?.version != null) {
    const version =
      options.version instanceof Date
        ? options.version
            .getTime()
            .toString()
        : String(options.version);

    query.push(
      `v=${encodeURIComponent(
        version,
      )}`,
    );
  }

  if (query.length === 0) {
    return url;
  }

  return `${url}${
    url.includes('?')
      ? '&'
      : '?'
  }${query.join('&')}`;
}

function isPublicAssetPath(
  value: string,
): boolean {
  const normalized = String(value)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (normalized === 'logo.svg') {
    return true;
  }

  return PUBLIC_ASSET_PREFIXES.some(
    (prefix) =>
      normalized.startsWith(prefix),
  );
}

function publicAssetUrl(
  relativePath: string,
): string | null {
  const encodedPath =
    encodeAssetPath(relativePath);

  if (!encodedPath) {
    return null;
  }

  const rawBaseUrl = String(
    import.meta.env.BASE_URL || '/',
  ).trim() || '/';

  const baseUrl =
    rawBaseUrl.endsWith('/')
      ? rawBaseUrl
      : `${rawBaseUrl}/`;

  return `${baseUrl}${encodedPath}`;
}

function fallbackAssetUrl(
  value?: string,
): string {
  const normalized = String(
    value ?? '',
  ).trim();

  if (!normalized) {
    return '';
  }

  if (isPublicAssetPath(normalized)) {
    return (
      publicAssetUrl(normalized)
      ?? ''
    );
  }

  return normalized;
}

export function resolveAssetUrl(
  assetKey?: string | null,
  options?: ResolveAssetUrlOptions,
): string {
  const normalizedKey = String(
    assetKey ?? '',
  ).trim();

  if (!normalizedKey) {
    return fallbackAssetUrl(
      options?.fallback,
    );
  }

  if (
    normalizedKey.startsWith('http://')
    || normalizedKey.startsWith('https://')
    || normalizedKey.startsWith('blob:')
    || normalizedKey.startsWith('data:')
    || normalizedKey.startsWith('file:')
  ) {
    return appendAssetQuery(
      normalizedKey,
      options,
    );
  }

  if (
    normalizedKey.startsWith(
      BUILTIN_ASSET_PREFIX,
    )
  ) {
    const builtinUrl = publicAssetUrl(
      `builtin/${normalizedKey.slice(
        BUILTIN_ASSET_PREFIX.length,
      )}`,
    );

    return builtinUrl
      ? appendAssetQuery(
          builtinUrl,
          options,
        )
      : fallbackAssetUrl(
          options?.fallback,
        );
  }

  if (normalizedKey.startsWith('public/')) {
    const publicUrl = publicAssetUrl(
      normalizedKey.slice(
        'public/'.length,
      ),
    );

    return publicUrl
      ? appendAssetQuery(
          publicUrl,
          options,
        )
      : fallbackAssetUrl(
          options?.fallback,
        );
  }

  if (isPublicAssetPath(normalizedKey)) {
    const publicUrl =
      publicAssetUrl(
        normalizedKey,
      );

    return publicUrl
      ? appendAssetQuery(
          publicUrl,
          options,
        )
      : fallbackAssetUrl(
          options?.fallback,
        );
  }

  if (normalizedKey.startsWith('/')) {
    return appendAssetQuery(
      normalizedKey,
      options,
    );
  }

  const encodedPath =
    encodeAssetPath(normalizedKey);

  if (!encodedPath) {
    return fallbackAssetUrl(
      options?.fallback,
    );
  }

  return appendAssetQuery(
    `/${encodedPath}`,
    options,
  );
}
