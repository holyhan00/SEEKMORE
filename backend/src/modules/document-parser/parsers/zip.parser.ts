                                                            

import { BadRequestException, Injectable } from '@nestjs/common';
import { ParseDocumentInput, ParsedDocument } from '../document.types';
import { DocumentParser } from './document-parser.interface';
import {
  inspectZipCentralDirectory,
  ZipContainerError,
} from './zip-central-directory.util';

@Injectable()
export class ZipDocumentParser implements DocumentParser {
  readonly kind = 'zip' as const;
  readonly version = '2.0.0';

  readonly support = {
    mimeTypes: ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip'],
    extensions: ['zip'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();
    return (
      this.support.extensions.includes(ext || '')
      || this.support.mimeTypes.includes(input.mimeType || '')
    );
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    try {
      const manifest = inspectZipCentralDirectory(input.buffer, {
        maxEntries: 5_000,
        maxCentralDirectoryBytes: 16 * 1024 * 1024,
        maxEntryUncompressedBytes: 2 * 1024 * 1024 * 1024,
        maxTotalUncompressedBytes: 8 * 1024 * 1024 * 1024,
        maxCompressionRatio: 100_000,
      });
      const files = manifest.entries.filter((entry) => !entry.directory);
      const directories = manifest.entries.filter((entry) => entry.directory);
      const preview = files
        .slice(0, 100)
        .map((entry, index) => `${index + 1}. ${entry.name} (${entry.uncompressedSize} bytes)`)
        .join('\n');

      return {
        text: [
          `Archive: ${input.objectName}`,
          `Directories: ${directories.length}`,
          `Files: ${files.length}`,
          '',
          preview,
        ].join('\n'),
        title: input.objectName,
        kind: this.kind,
        mimeType: input.mimeType,
        extension: input.extension,
        sections: [{
          title: 'Archive file list',
          content: preview,
          level: 1,
          meta: { fileCount: files.length, directoryCount: directories.length },
        }],
        meta: {
          parserVersion: 'zip-central-directory',
          fileCount: files.length,
          directoryCount: directories.length,
          totalCompressedBytes: manifest.totalCompressedBytes,
          totalUncompressedBytes: manifest.totalUncompressedBytes,
          entries: manifest.entries.map((entry) => ({
            name: entry.name,
            size: entry.uncompressedSize,
            compressedSize: entry.compressedSize,
            directory: entry.directory,
            method: entry.method,
            encrypted: entry.encrypted,
            unsafePath: entry.unsafePath,
          })),
        },
      };
    } catch (error) {
      if (error instanceof ZipContainerError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }
  }
}
