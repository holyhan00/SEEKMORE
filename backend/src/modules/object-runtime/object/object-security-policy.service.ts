                                                                              
import { BadRequestException, Injectable } from '@nestjs/common';
import type { ObjectKind } from './object.types';

export interface RuntimeObjectSecurityCheckInput {
  originalName: string;
  mimeType?: string | null;
  sizeBytes: number;
  objectKind: ObjectKind;
  buffer: Buffer;
}

export interface RuntimeObjectSecurityCheckResult {
  normalizedName: string;
  mimeType: string;
}

@Injectable()
export class RuntimeObjectSecurityPolicyService {
  readonly maxUploadBytes = this.readMaxUploadBytes();

  check(
    input: RuntimeObjectSecurityCheckInput,
  ): RuntimeObjectSecurityCheckResult {
    if (
      !Buffer.isBuffer(input.buffer) ||
      input.buffer.length <= 0 ||
      input.sizeBytes <= 0
    ) {
      throw new BadRequestException('OBJECT_EMPTY_FILE');
    }

    if (input.sizeBytes !== input.buffer.length) {
      throw new BadRequestException('OBJECT_SIZE_MISMATCH');
    }

    if (input.sizeBytes > this.maxUploadBytes) {
      throw new BadRequestException({
        code: 'OBJECT_TOO_LARGE',
        message: 'OBJECT_TOO_LARGE',
        params: { sizeBytes: input.sizeBytes, maxBytes: this.maxUploadBytes },
      });
    }

    const repairedName = this.repairMultipartFileName(
      String(input.originalName ?? ''),
    );

    if (this.hasPathSyntax(repairedName)) {
      throw new BadRequestException('OBJECT_UNSAFE_FILE_NAME');
    }

    return {
      normalizedName: this.normalizeName(repairedName),
      mimeType: this.normalizeMimeType(input.mimeType),
    };
  }

  normalizeName(name: string): string {
    const repairedName = this.repairMultipartFileName(
      String(name || 'file'),
    );

    const normalized = repairedName
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);

    return normalized || 'file';
  }

     
                                         
    
        
                
                           
                        
    
                           
                      
     
  private repairMultipartFileName(value: string): string {
    const original = String(value ?? '');

    if (!original) {
      return original;
    }

    let decoded: string;

    try {
      decoded = Buffer.from(original, 'latin1').toString('utf8');
    } catch {
      return original;
    }

    if (!decoded || decoded.includes('\uFFFD')) {
      return original;
    }

    if (decoded === original) {
      return original;
    }

    const originalScore = this.calculateFileNameQuality(original);
    const decodedScore = this.calculateFileNameQuality(decoded);

    return decodedScore > originalScore ? decoded : original;
  }

     
                    
    
                                          
                
     
  private calculateFileNameQuality(value: string): number {
    let score = 0;

    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;

      if (this.isCjkCodePoint(codePoint)) {
        score += 5;
        continue;
      }

      if (this.isPrintableAscii(codePoint)) {
        score += 2;
        continue;
      }

      if (this.isCommonUnicodeLetterOrNumber(character)) {
        score += 2;
        continue;
      }

      if (this.isC1ControlCharacter(codePoint)) {
        score -= 10;
        continue;
      }

      if (this.isUnicodeControlCharacter(character)) {
        score -= 10;
        continue;
      }

      score += 1;
    }

    score -= this.countMojibakeMarkers(value) * 3;

    return score;
  }

  private isCjkCodePoint(codePoint: number): boolean {
    return (
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af)
    );
  }

  private isPrintableAscii(codePoint: number): boolean {
    return codePoint >= 0x20 && codePoint <= 0x7e;
  }

  private isC1ControlCharacter(codePoint: number): boolean {
    return codePoint >= 0x80 && codePoint <= 0x9f;
  }

  private isUnicodeControlCharacter(character: string): boolean {
    return /\p{Cc}/u.test(character);
  }

  private isCommonUnicodeLetterOrNumber(character: string): boolean {
    return /[\p{L}\p{N}\p{M}]/u.test(character);
  }

  private countMojibakeMarkers(value: string): number {
    const markers = [
      'Ã',
      'Â',
      'æ',
      'å',
      'ä',
      'ç',
      'è',
      'é',
      'ð',
      'ï',
      '¤',
      '¦',
      '©',
      '®',
    ];

    let count = 0;

    for (const marker of markers) {
      count += value.split(marker).length - 1;
    }

    return count;
  }

  private normalizeMimeType(value?: string | null): string {
    const mimeType = String(value ?? '')
      .trim()
      .toLowerCase();

    if (
      !mimeType ||
      mimeType.length > 160 ||
      !/^[a-z0-9!#$&^_.+\-]+\/[a-z0-9!#$&^_.+\-]+$/.test(
        mimeType,
      )
    ) {
      return 'application/octet-stream';
    }

    return mimeType;
  }

  private hasPathSyntax(value: string): boolean {
    const name = String(value ?? '');

    return (
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('\u0000') ||
      name === '.' ||
      name === '..'
    );
  }

  private readMaxUploadBytes(): number {
    const fallback = 100 * 1024 * 1024;
    const configured = Number(
      process.env.OBJECT_CATALOG_MAX_UPLOAD_BYTES ?? fallback,
    );

    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : fallback;
  }
}