import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RuntimeObjectRepository } from './object.repository';

@Injectable()
export class RuntimeObjectVersionService {
  constructor(private readonly repo: RuntimeObjectRepository) {}

  async resolve(input: {
    userId: string;
    baseName: string;
    extension: string;
  }): Promise<{ duplicateGroupKey: string; versionNo: number; displayName: string }> {
    const normalizedBaseName = this.normalizeBaseName(input.baseName);
    const normalizedExtension = this.normalizeExtension(input.extension);
    const duplicateGroupKey = this.groupKey({
      userId: input.userId,
      normalizedBaseName,
      normalizedExtension,
    });

                                                                              
                                                                             
                                                
    const candidates = await this.repo.findVersionCandidates({
      userId: input.userId,
      extension: normalizedExtension,
    });
    const existing = candidates.filter(
      (object) =>
        this.normalizeBaseName(object.baseName) === normalizedBaseName
        && this.normalizeExtension(object.extension) === normalizedExtension,
    );
    const versionNo = existing.reduce(
      (max, object) => Math.max(max, object.versionNo),
      -1,
    ) + 1;

    return {
      duplicateGroupKey,
      versionNo,
      displayName: this.displayName(input.baseName, normalizedExtension, versionNo),
    };
  }

  private groupKey(input: {
    userId: string;
    normalizedBaseName: string;
    normalizedExtension: string;
  }): string {
                                                                             
                                                                            
    const raw = [
      input.userId,
      input.normalizedBaseName,
      input.normalizedExtension,
    ].join('\u001f');
    return createHash('sha256').update(raw).digest('hex');
  }

  private normalizeBaseName(value: string): string {
    return String(value ?? '')
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase('en-US');
  }

  private normalizeExtension(value: string): string {
    return String(value ?? '').trim().replace(/^\./, '').toLowerCase();
  }

  private displayName(baseName: string, extension: string, versionNo: number): string {
    const suffix = extension ? `.${extension}` : '';
    return versionNo === 0 ? `${baseName}${suffix}` : `${baseName} (${versionNo})${suffix}`;
  }
}
