import { Injectable, NotFoundException } from '@nestjs/common';
import type { RuntimeObject } from '@prisma/client';
import { RuntimeObjectService } from '../object/object.service';
import { RuntimeObjectStorageService } from '../object/object-storage.service';
import type {
  RuntimeObjectPreviewKind,
  RuntimeObjectPreviewManifest,
  RuntimeObjectPreviewSource,
} from './object-preview.types';

@Injectable()
export class RuntimeObjectPreviewService {
  constructor(
    private readonly objects: RuntimeObjectService,
    private readonly storage: RuntimeObjectStorageService,
  ) {}

  async manifest(
    userId: string,
    objectId: string,
  ): Promise<RuntimeObjectPreviewManifest> {
    const object = await this.objects.inspectOwned(userId, objectId);
    const source = this.resolveSource(object);

    return {
      objectId: object.id,
      objectKind: object.objectKind,
      mimeType: object.mimeType,
      extension: object.extension,
      displayName: object.displayName,
      downloadUrl: this.downloadUrl(object.id),
      preview: source
        ? {
            kind: source.kind,
            available: true,
            mimeType: source.mimeType,
            url: this.previewUrl(
              object.id,
              source.contentHash,
            ),
          }
        : {
            kind: 'unsupported',
            available: false,
          },
    };
  }

  async source(
    userId: string,
    objectId: string,
  ): Promise<RuntimeObjectPreviewSource> {
    const object = await this.objects.inspectOwned(userId, objectId);
    const source = this.resolveSource(object);
    if (!source) {
      throw new NotFoundException('OBJECT_PREVIEW_NOT_AVAILABLE');
    }

    const stored = await this.storage.stat(source.storageKey).catch(() => null);
    if (!stored || stored.sizeBytes !== source.sizeBytes) {
      throw new NotFoundException('OBJECT_PREVIEW_NOT_AVAILABLE');
    }

    return source;
  }

  createReadStream(source: RuntimeObjectPreviewSource) {
    return this.storage.createReadStream(source.storageKey);
  }

  private resolveSource(
    object: RuntimeObject,
  ): RuntimeObjectPreviewSource | null {
    const metadata = record(object.metadata);
    const preview = record(metadata.preview);
    const previewStorageKey = text(preview.storageKey);
    const previewKind = this.previewKind(preview.kind);
    const previewMimeType = text(preview.mimeType);
    const previewContentHash = text(preview.contentHash);
    const previewSizeBytes = positiveNumber(preview.sizeBytes);

    if (
      previewStorageKey
      && previewKind
      && previewMimeType
      && previewContentHash
      && previewSizeBytes !== null
      && this.isOwnedPreviewStorageKey(
        object.storageKey,
        previewStorageKey,
      )
    ) {
      return {
        objectId: object.id,
        kind: previewKind,
        storageKey: previewStorageKey,
        mimeType: previewMimeType,
        sizeBytes: previewSizeBytes,
        contentHash: previewContentHash,
        displayName: object.displayName,
      };
    }

    const directKind = this.directPreviewKind(object);
    if (!directKind) return null;

    return {
      objectId: object.id,
      kind: directKind,
      storageKey: object.storageKey,
      mimeType: object.mimeType || 'application/octet-stream',
      sizeBytes: Number(object.sizeBytes),
      contentHash: object.contentHash,
      displayName: object.displayName,
    };
  }

  private directPreviewKind(
    object: RuntimeObject,
  ): Exclude<RuntimeObjectPreviewKind, 'unsupported'> | null {
    const kind = String(object.objectKind ?? '').trim().toLowerCase();
    const mimeType = String(object.mimeType ?? '').trim().toLowerCase();
    const extension = String(object.extension ?? '').trim().toLowerCase();

    if (kind === 'image' || mimeType.startsWith('image/')) return 'image';
    if (kind === 'pdf' || mimeType === 'application/pdf') return 'pdf';
    if (kind === 'html' || mimeType.includes('html')) return 'html';
    if (kind === 'markdown' || mimeType.includes('markdown')) return 'markdown';
    if (kind === 'audio' || mimeType.startsWith('audio/')) return 'audio';
    if (kind === 'video' || mimeType.startsWith('video/')) return 'video';
    if (kind === 'spreadsheet' && extension === 'csv') return 'spreadsheet';
    if (kind === 'text' || mimeType.startsWith('text/')) return 'text';
    if (kind === 'code' && this.isTextCode(extension, mimeType)) return 'text';

    return null;
  }

  private previewKind(
    value: unknown,
  ): Exclude<RuntimeObjectPreviewKind, 'unsupported'> | null {
    const kind = String(value ?? '').trim().toLowerCase();
    if (
      kind === 'image'
      || kind === 'pdf'
      || kind === 'html'
      || kind === 'document'
      || kind === 'spreadsheet'
      || kind === 'presentation'
      || kind === 'markdown'
      || kind === 'text'
      || kind === 'audio'
      || kind === 'video'
    ) {
      return kind;
    }
    return null;
  }

  private isTextCode(extension: string, mimeType: string): boolean {
    if (
      mimeType.startsWith('text/')
      || mimeType === 'application/json'
      || mimeType.includes('xml')
      || mimeType.includes('javascript')
    ) {
      return true;
    }

    return new Set([
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'go', 'rs', 'php', 'rb',
      'swift', 'kt', 'kts', 'cs', 'c', 'h', 'cpp', 'hpp', 'vue', 'svelte', 'css',
      'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'sh', 'bash',
      'zsh', 'ps1', 'prisma', 'graphql', 'gql', 'proto',
    ]).has(extension);
  }

  private downloadUrl(objectId: string): string {
    return `/api/objects/${encodeURIComponent(objectId)}/download`;
  }

  private previewUrl(objectId: string, version: string): string {
    return `/api/objects/${encodeURIComponent(objectId)}/preview?v=${encodeURIComponent(version)}`;
  }

  private isOwnedPreviewStorageKey(
    originalStorageKey: string,
    previewStorageKey: string,
  ): boolean {
    const original = String(originalStorageKey ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const preview = String(previewStorageKey ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const marker = '/original/';
    const markerIndex = original.lastIndexOf(marker);

    if (markerIndex <= 0) return false;

    const objectRoot = original.slice(0, markerIndex);
    return preview.startsWith(`${objectRoot}/preview/`);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  const output = String(value ?? '').trim();
  return output || null;
}

function positiveNumber(value: unknown): number | null {
  const output = Number(value);
  return Number.isFinite(output) && output > 0 ? output : null;
}
