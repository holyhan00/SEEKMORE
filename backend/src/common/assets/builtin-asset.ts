                                             

const BUILTIN_ASSET_PREFIX = 'builtin:';

function encodeBuiltinPath(
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

export function resolveBuiltinAssetUrl(
  assetKey?: string | null,
  updatedAt?: Date | number | string | null,
): string | null {
  const normalizedKey = String(
    assetKey ?? '',
  ).trim();

  if (
    !normalizedKey.startsWith(
      BUILTIN_ASSET_PREFIX,
    )
  ) {
    return null;
  }

  const encodedPath = encodeBuiltinPath(
    normalizedKey.slice(
      BUILTIN_ASSET_PREFIX.length,
    ),
  );

  if (!encodedPath) {
    return null;
  }

  const base = `/builtin/${encodedPath}`;

  if (updatedAt == null) {
    return base;
  }

  const version =
    updatedAt instanceof Date
      ? updatedAt.getTime().toString()
      : String(updatedAt);

  return `${base}?v=${encodeURIComponent(
    version,
  )}`;
}
