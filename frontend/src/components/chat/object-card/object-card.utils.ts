import { resolveAssetUrl } from '../../../utils/asset-url';

const FILE_TYPE_ICONS: Record<string, string> = {
  doc: resolveAssetUrl('/icons/file/w.svg'),
  docx: resolveAssetUrl('/icons/file/w.svg'),
  document: resolveAssetUrl('/icons/file/w.svg'),
  word: resolveAssetUrl('/icons/file/w.svg'),

  xls: resolveAssetUrl('/icons/file/x.svg'),
  xlsx: resolveAssetUrl('/icons/file/x.svg'),
  csv: resolveAssetUrl('/icons/file/x.svg'),
  spreadsheet: resolveAssetUrl('/icons/file/x.svg'),
  excel: resolveAssetUrl('/icons/file/x.svg'),

  ppt: resolveAssetUrl('/icons/file/p.svg'),
  pptx: resolveAssetUrl('/icons/file/p.svg'),
  presentation: resolveAssetUrl('/icons/file/p.svg'),
  powerpoint: resolveAssetUrl('/icons/file/p.svg'),

  pdf: resolveAssetUrl('/icons/file/pdf.svg'),
  zip: resolveAssetUrl('/icons/file/zip.svg'),
  archive: resolveAssetUrl('/icons/file/zip.svg'),

  audio: resolveAssetUrl('/icons/file/m.svg'),
  mp3: resolveAssetUrl('/icons/file/m.svg'),
  wav: resolveAssetUrl('/icons/file/m.svg'),
  m4a: resolveAssetUrl('/icons/file/m.svg'),
  aac: resolveAssetUrl('/icons/file/m.svg'),
  flac: resolveAssetUrl('/icons/file/m.svg'),
  ogg: resolveAssetUrl('/icons/file/m.svg'),
  opus: resolveAssetUrl('/icons/file/m.svg'),
  webm: resolveAssetUrl('/icons/file/m.svg'),
  video: resolveAssetUrl('/icons/file/v.svg'),

  file: resolveAssetUrl('/icons/file/com.svg'),
};

export function resolveFileType(
  fileType?: string,
  filename?: string,
): string {
  const raw = String(fileType ?? '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase();

  if (FILE_TYPE_ICONS[raw]) {
    return raw;
  }

  const extension = String(filename ?? '')
    .trim()
    .toLowerCase()
    .split('.')
    .pop();

  if (
    extension
    && FILE_TYPE_ICONS[extension]
  ) {
    return extension;
  }

  return raw || 'file';
}

export function resolveFileIcon(
  fileType?: string,
  filename?: string,
): string {
  const resolvedType = resolveFileType(
    fileType,
    filename,
  );

  return FILE_TYPE_ICONS[resolvedType]
    ?? FILE_TYPE_ICONS.file;
}

export function formatDisplaySize(
  value?: string | number,
): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }

  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
  ) {
    return null;
  }

  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  if (value < 1024 ** 2) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  if (value < 1024 ** 3) {
    return `${(
      value / 1024 ** 2
    ).toFixed(1)} MB`;
  }

  return `${(
    value / 1024 ** 3
  ).toFixed(1)} GB`;
}

export function isImageObject(
  objectKind?: string,
  mimeType?: string,
): boolean {
  return String(objectKind ?? '')
    .toLowerCase() === 'image'
    || String(mimeType ?? '')
      .toLowerCase()
      .startsWith('image/');
}

export function isAudioObject(
  objectKind?: string,
  mimeType?: string,
): boolean {
  return String(objectKind ?? '')
    .toLowerCase() === 'audio'
    || String(mimeType ?? '')
      .toLowerCase()
      .startsWith('audio/');
}

export function mediaAspectRatio(
  media?: {
    width?: number;
    height?: number;
  },
): number | null {
  const width = Number(media?.width);
  const height = Number(media?.height);

  return Number.isFinite(width)
    && Number.isFinite(height)
    && width > 0
    && height > 0
      ? width / height
      : null;
}
