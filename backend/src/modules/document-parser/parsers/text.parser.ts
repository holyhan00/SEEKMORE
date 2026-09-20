                                                             

import { BadRequestException, Injectable } from '@nestjs/common';
import { ParseDocumentInput, ParsedDocument } from '../document.types';
import { DocumentParser } from './document-parser.interface';

@Injectable()
export class TextDocumentParser implements DocumentParser {
  readonly kind = 'text' as const;
  readonly version = '1.0.0';

  readonly support = {
    mimeTypes: ['text/plain'],
    extensions: ['txt', 'log'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();
    return (
      this.support.extensions.includes(ext || '')
      || this.support.mimeTypes.includes(input.mimeType || '')
    );
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    const sample = input.buffer.subarray(0, Math.min(input.buffer.length, 8192));
    if (sample.includes(0)) {
      throw new BadRequestException({ code: 'DOCUMENT_TEXT_INVALID', message: 'DOCUMENT_TEXT_INVALID', params: { objectName: input.objectName } });
    }

    return {
      text: input.buffer.toString('utf8').replace(/^\uFEFF/, ''),
      title: input.objectName,
      kind: this.kind,
      mimeType: input.mimeType,
      extension: input.extension,
      meta: {},
    };
  }
}
