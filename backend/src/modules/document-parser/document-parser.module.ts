                                                        
import { Module, OnModuleInit } from '@nestjs/common';
import { DocumentParserService } from './document-parser.service';
import { DocumentParserRegistry } from './document-parser.registry';
import { TextDocumentParser } from './parsers/text.parser';
import { MarkdownDocumentParser } from './parsers/markdown.parser';
import { JsonDocumentParser } from './parsers/json.parser';
import { PdfDocumentParser } from './parsers/pdf.parser';
import { DocxDocumentParser } from './parsers/docx.parser';
import { XlsxDocumentParser } from './parsers/xlsx.parser';
import { HtmlDocumentParser } from './parsers/html.parser';
import { ZipDocumentParser } from './parsers/zip.parser';
import { CodeDocumentParser } from './parsers/code.parser';
import { CsvDocumentParser } from './parsers/csv.parser';

@Module({
  providers: [
    DocumentParserService,
    DocumentParserRegistry,
    TextDocumentParser,
    MarkdownDocumentParser,
    JsonDocumentParser,
    PdfDocumentParser,
    DocxDocumentParser,
    XlsxDocumentParser,
    HtmlDocumentParser,
    ZipDocumentParser,
    CodeDocumentParser,
    CsvDocumentParser,
  ],
  exports: [DocumentParserService, DocumentParserRegistry],
})
export class DocumentParserModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentParserRegistry,
    private readonly text: TextDocumentParser,
    private readonly markdown: MarkdownDocumentParser,
    private readonly json: JsonDocumentParser,
    private readonly pdf: PdfDocumentParser,
    private readonly docx: DocxDocumentParser,
    private readonly xlsx: XlsxDocumentParser,
    private readonly html: HtmlDocumentParser,
    private readonly zip: ZipDocumentParser,
    private readonly code: CodeDocumentParser,
    private readonly csv: CsvDocumentParser,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.markdown);
    this.registry.register(this.json);
    this.registry.register(this.pdf);
    this.registry.register(this.docx);
    this.registry.register(this.xlsx);
    this.registry.register(this.html);
    this.registry.register(this.zip);
    this.registry.register(this.code);
    this.registry.register(this.csv);
    this.registry.register(this.text);
  }
}
