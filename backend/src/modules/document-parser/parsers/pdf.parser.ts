                                                            

import { Injectable } from '@nestjs/common';
import * as pdfParseModule from 'pdf-parse';
import { ParseDocumentInput, ParsedDocument } from '../document.types';
import { DocumentParser } from './document-parser.interface';

type PdfParseResult = {
  text?: string;
  numpages?: number;
  info?: unknown;
};

@Injectable()
export class PdfDocumentParser implements DocumentParser {
  readonly kind = 'pdf' as const;
  readonly version = '1.0.0';

  readonly support = {
    mimeTypes: ['application/pdf'],
    extensions: ['pdf'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();
    return ext === 'pdf' || input.mimeType === 'application/pdf';
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    const pdfParse =
      (pdfParseModule as unknown as { default?: unknown }).default ??
      pdfParseModule;

    if (typeof pdfParse !== 'function') {
      throw new Error('The installed pdf-parse export format is incompatible; use pdf-parse@1.1.1.');
    }

    const parsed = (await pdfParse(input.buffer)) as PdfParseResult;

    return {
      text: parsed.text || '',
      title: input.objectName,
      kind: this.kind,
      mimeType: input.mimeType,
      extension: input.extension,
      meta: {
        pages: parsed.numpages || null,
        info: parsed.info || null,
      },
    };
  }
}
