export function buildSeekmoreDownloadFilename(
  filename?: string | null,
): string {
  const normalized = String(filename ?? '')
    .trim()
    || 'download';

  return /^seekmore-/i.test(normalized)
    ? `Seekmore-${normalized.replace(/^seekmore-/i, '')}`
    : `Seekmore-${normalized}`;
}
