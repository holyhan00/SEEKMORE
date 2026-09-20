                                                    

import { BadRequestException, Injectable } from '@nestjs/common';
import { ParseDocumentInput, ParsedDocument } from '../document.types';
import { DocumentParser } from './document-parser.interface';

@Injectable()
export class JsonDocumentParser implements DocumentParser {
  readonly kind = 'json' as const;
  readonly version = '1.0.0';

  readonly support = {
    mimeTypes: ['application/json', 'text/json'],
    extensions: ['json'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();
    return (
      this.support.extensions.includes(ext || '') ||
      this.support.mimeTypes.includes(input.mimeType || '')
    );
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    const raw = input.buffer.toString('utf8').replace(/^\uFEFF/, '');

    try {
      const parsed = JSON.parse(raw);
      return {
        text: JSON.stringify(parsed, null, 2),
        title: input.objectName,
        kind: this.kind,
        mimeType: input.mimeType,
        extension: input.extension,
        meta: { validJson: true },
      };
    } catch (error) {
      throw new BadRequestException({
        code: 'DOCUMENT_JSON_INVALID',
        message: `Invalid JSON file content: ${input.objectName}`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
