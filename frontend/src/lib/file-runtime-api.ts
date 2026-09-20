                                       
import { localizeText } from '../localization/localization';
import { api } from './http';


export class ObjectUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ObjectUploadError';
  }
}

const UNSUPPORTED_OBJECT_UPLOAD_CODES = new Set([
  'IMAGE_INPUT_UNSUPPORTED_FORMAT',
  'OBJECT_TYPE_UNSUPPORTED',
  'DOCUMENT_TYPE_UNSUPPORTED',
]);

export function isUnsupportedObjectUploadError(error: unknown): boolean {
  return error instanceof ObjectUploadError
    && UNSUPPORTED_OBJECT_UPLOAD_CODES.has(error.code);
}

export type ObjectUploadPartition = {
  agentId: string;
  conversationId: string;
};

export type ObjectCatalogCardDto = {
  objectId?: string;
  id?: string;

  originalName?: string;
  displayName?: string;

  objectKind?: string | null;
  extension?: string | null;
  mimeType?: string | null;

  sizeBytes?: number | string | null;
  contentHash?: string | null;
  versionNo?: number | null;

  downloadUrl?: string | null;
  previewUrl?: string | null;
  media?: {
    width?: number | null;
    height?: number | null;
    format?: string | null;
    hasAlpha?: boolean | null;
  } | null;
  readyForMessageInput?: boolean | null;
  status?: string | null;
  uploadStatus?: string | null;
  createdAt?: string | null;
  processingStatus?: string | null;
  capabilities?: string[] | null;
  contentSummary?: string | null;
  parser?: string | null;
  processorVersion?: string | null;

  [key: string]: unknown;
};

export function formatFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = sizeBytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const fixed = size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${fixed} ${units[unitIndex]}`;
}

export function inferFileType(filename: string, mimeType?: string | null): string {
  const mime = String(mimeType ?? '').toLowerCase();

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('zip') || mime.includes('compressed')) return 'archive';
  if (mime.includes('word') || mime.includes('wordprocessingml')) return 'document';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return 'spreadsheet';
  if (mime.includes('powerpoint') || mime.includes('presentation')) return 'presentation';
  if (mime.includes('json') || mime.startsWith('text/')) return 'text';

  const lower = String(filename || '').toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() || '' : '';
  return ext || 'unknown';
}

export type ObjectUploadProgress = {
  phase: 'uploading' | 'processing';
  progress: number;
};

export async function uploadFileAsset(
  file: File,
  partition: ObjectUploadPartition,
  onProgress?: (progress: ObjectUploadProgress) => void,
): Promise<ObjectCatalogCardDto> {
  const agentId = String(partition.agentId ?? '').trim();
  const conversationId = String(partition.conversationId ?? '').trim();
  if (!agentId || !conversationId) {
    throw new Error(localizeText('files.upload.partitionRequired'));
  }

  const form = new FormData();
  form.append('object', file, file.name);
  form.append('agentId', agentId);
  form.append('conversationId', conversationId);

  try {
    const { data } = await api.post('/objects/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        const total = Number(event.total ?? file.size);
        const loaded = Number(event.loaded ?? 0);
        const progress = total > 0
          ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100)))
          : 0;

        onProgress?.({
          phase: progress >= 100 ? 'processing' : 'uploading',
          progress,
        });
      },
    });

    const dto = (data && ((data as { data?: ObjectCatalogCardDto }).data ?? data)) as ObjectCatalogCardDto;
    return normalizeObjectCatalogUploadDto(dto, file);
  } catch (error: any) {
    const response = error?.response?.data;
    const code = responseCode(response);
    const fallbackMessage = responseMessage(response)
      || String(error?.message ?? '').trim()
      || localizeText('files.upload.processFailed');
    throw new ObjectUploadError(
      code || 'OBJECT_UPLOAD_FAILED',
      objectUploadMessage(code, fallbackMessage),
    );
  }
}

function normalizeObjectCatalogUploadDto(
  dto: ObjectCatalogCardDto,
  fallbackFile: File,
): ObjectCatalogCardDto {
  const objectId = stringOrNull(dto.objectId) ?? stringOrNull(dto.id);
  if (!objectId) throw new Error(localizeText('files.upload.missingObjectId'));

  const originalName = stringOrNull(dto.originalName) ?? fallbackFile.name;
  const displayName = stringOrNull(dto.displayName) ?? originalName;
  const extension = stringOrNull(dto.extension) ?? fileExtension(originalName);
  const objectKind = stringOrNull(dto.objectKind) ?? inferFileType(originalName, dto.mimeType ?? fallbackFile.type);
  const sizeBytes = numberOrFallback(dto.sizeBytes, fallbackFile.size);
  const status = stringOrNull(dto.status);
  const processingStatus = stringOrNull(dto.processingStatus);
  if (
    status !== 'available'
    || processingStatus !== 'ready'
    || dto.readyForMessageInput === false
  ) {
    throw new Error(localizeText('files.upload.objectNotReady'));
  }

  return {
    ...dto,
    id: objectId,
    objectId,
    originalName,
    displayName,
    objectKind,
    extension,
    mimeType: stringOrNull(dto.mimeType) ?? fallbackFile.type ?? 'application/octet-stream',
    sizeBytes,
    downloadUrl: stringOrNull(dto.downloadUrl),
    previewUrl: stringOrNull(dto.previewUrl),
    contentHash: stringOrNull(dto.contentHash),
    versionNo: positiveIntegerOrNull(dto.versionNo),
    media: normalizeMedia(dto.media),
    readyForMessageInput: true,
    status: 'available',
    uploadStatus: 'ready',
    processingStatus: 'ready',
  };
}

function fileExtension(filename: string): string | null {
  const value = String(filename ?? '').trim();
  const index = value.lastIndexOf('.');
  if (index <= 0 || index === value.length - 1) return null;
  return value.slice(index + 1).toLowerCase();
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

function numberOrFallback(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeMedia(value: ObjectCatalogCardDto['media']): ObjectCatalogCardDto['media'] {
  if (!value || typeof value !== 'object') return null;
  const width = numberOrNull(value.width);
  const height = numberOrNull(value.height);
  const format = stringOrNull(value.format);
  const hasAlpha = typeof value.hasAlpha === 'boolean' ? value.hasAlpha : null;
  if (width === null && height === null && !format && hasAlpha === null) return null;
  return { width, height, format, hasAlpha };
}

function positiveIntegerOrNull(value: unknown): number | null {
  const number = numberOrNull(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}


function responseCode(response: unknown): string {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return '';
  const input = response as Record<string, unknown>;
  const explicit = typeof input.code === 'string' ? input.code.trim() : '';
  if (explicit) return explicit;
  return responseMessage(response);
}

function responseMessage(response: unknown): string {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return '';
  const value = (response as Record<string, unknown>).message;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string' && item.trim());
    return typeof first === 'string' ? first.trim() : '';
  }
  const fallback = (response as Record<string, unknown>).error;
  return typeof fallback === 'string' ? fallback.trim() : '';
}

function objectUploadMessage(code: string, fallback: string): string {
  switch (code) {
    case 'IMAGE_INPUT_UNSUPPORTED_FORMAT':
      return localizeText('files.image.unsupportedFormat');
    case 'IMAGE_DECODE_FAILED':
      return localizeText('files.image.decodeFailed');
    case 'OBJECT_TYPE_UNSUPPORTED':
    case 'DOCUMENT_TYPE_UNSUPPORTED':
      return localizeText('files.type.unsupported');
    default:
      return fallback;
  }
}
