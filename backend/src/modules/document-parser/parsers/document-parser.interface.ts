                                                                           

import {
  DocumentParserKind,
  DocumentParseSupport,
  ParseDocumentInput,
  ParsedDocument,
} from '../document.types';

export interface DocumentParser {
  readonly kind: DocumentParserKind;
  readonly version: string;
  readonly support: DocumentParseSupport;

  canParse(input: ParseDocumentInput): boolean;

  parse(input: ParseDocumentInput): Promise<ParsedDocument>;
}
