import { Injectable } from '@nestjs/common';
import type { ObjectKind } from './object.types';

@Injectable()
export class RuntimeObjectKindService {
  detect(input: { objectName: string; mimeType?: string | null; buffer?: Buffer }): ObjectKind {
    const ext = this.extension(input.objectName);
    const mime = String(input.mimeType ?? '').trim().toLowerCase();
    const magic = this.magic(input.buffer);

    if (magic === 'pdf' || ext === 'pdf' || mime === 'application/pdf') return 'pdf';
    if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(ext) || mime.includes('wordprocessingml')) return 'document';
    if (['xls', 'xlsx', 'ods', 'csv', 'numbers'].includes(ext) || mime.includes('spreadsheet')) return 'spreadsheet';
    if (['ppt', 'pptx', 'odp', 'key'].includes(ext) || mime.includes('presentation')) return 'presentation';
    if (['html', 'htm'].includes(ext) || mime.includes('html')) return 'html';
    if (['md', 'markdown'].includes(ext) || mime.includes('markdown')) return 'markdown';
    if (['txt', 'log'].includes(ext) || mime.startsWith('text/plain')) return 'text';
    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'svg', 'heic', 'heif', 'avif'].includes(ext)) return 'image';
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio';
    if (mime.startsWith('video/') || ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'].includes(ext)) return 'video';
    if (magic === 'zip' || ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'rar', '7z'].includes(ext)) return 'archive';
    if (this.isCodeExtension(ext)) return 'code';
    if (mime.startsWith('text/')) return 'text';
    if (mime && mime !== 'application/octet-stream') return 'binary';
    return ext ? 'binary' : 'unknown';
  }

  extension(objectName: string): string {
    const name = String(objectName ?? '').trim().toLowerCase();
    const index = name.lastIndexOf('.');
    return index > 0 && index < name.length - 1 ? name.slice(index + 1) : '';
  }

  baseName(objectName: string): string {
    const normalized = String(objectName ?? 'file').trim() || 'file';
    const index = normalized.lastIndexOf('.');
    return index > 0 ? normalized.slice(0, index) : normalized;
  }

  private magic(buffer?: Buffer): 'pdf' | 'zip' | 'unknown' {
    if (!buffer || buffer.length < 4) return 'unknown';
    if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'pdf';
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'zip';
    return 'unknown';
  }

  private isCodeExtension(ext: string): boolean {
    return new Set([
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'go', 'rs', 'php', 'rb', 'swift',
      'kt', 'kts', 'cs', 'c', 'h', 'cpp', 'hpp', 'vue', 'svelte', 'css', 'scss', 'less',
      'json', 'yaml', 'yml', 'toml', 'xml', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'dockerfile',
      'prisma', 'graphql', 'gql', 'proto',
    ]).has(ext);
  }
}
