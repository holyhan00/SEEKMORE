                                                                  

import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { ParseDocumentInput } from './document.types';
import { DocumentParser } from './parsers/document-parser.interface';

@Injectable()
export class DocumentParserRegistry {
  private readonly parsers: DocumentParser[] = [];

  register(parser: DocumentParser): void {
    const existing = this.parsers.find((item) => item.kind === parser.kind);
    if (existing) {
      throw new Error(
        `Document parser is already registered: ${parser.kind}@${existing.version}`,
      );
    }
    this.parsers.push(parser);
  }

  resolve(input: ParseDocumentInput): DocumentParser {
    const parser = this.parsers.find((item) => item.canParse(input));

    if (!parser) {
      throw new UnsupportedMediaTypeException({
        code: 'DOCUMENT_TYPE_UNSUPPORTED',
        message: `Unsupported document type: ${input.objectName} (${input.mimeType || 'unknown'})`,
        params: { objectName: input.objectName, mimeType: input.mimeType || 'unknown' },
      });
    }

    return parser;
  }

  listSupported(): Array<{
    kind: DocumentParser['kind'];
    version: string;
    mimeTypes: string[];
    extensions: string[];
  }> {
    return this.parsers.map((parser) => ({
      kind: parser.kind,
      version: parser.version,
      mimeTypes: [...parser.support.mimeTypes],
      extensions: [...parser.support.extensions],
    }));
  }
}
