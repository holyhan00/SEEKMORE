import { Injectable } from '@nestjs/common';
import { DocumentParserService } from '../../document-parser/document-parser.service';
import type {
  ObjectProcessingInput,
  ObjectProcessingResult,
  ObjectProcessor,
} from './object-processor.types';

@Injectable()
export class DocumentObjectProcessor implements ObjectProcessor {
  readonly name = 'document';

  constructor(private readonly parser: DocumentParserService) {}

  supports(kind: ObjectProcessingInput['objectKind']): boolean {
    return kind !== 'image' && kind !== 'audio';
  }

  async process(input: ObjectProcessingInput): Promise<ObjectProcessingResult> {
    const parsed = await this.parser.parse({
      buffer: input.buffer,
      objectName: input.originalName,
      mimeType: input.mimeType,
      extension: input.extension,
      source: 'object_upload',
    });
    const parsedMeta = record(parsed.meta);
    const parserName = String(parsedMeta.parser ?? parsed.kind ?? '').trim() || parsed.kind;
    const parserVersion = String(parsedMeta.parserVersion ?? '').trim() || 'unknown';
    const fullText = String(parsed.text ?? '');
    const text = fullText.slice(0, 200_000);

    return {
      processor: parserName,
      processorVersion: parserVersion,
      capabilities: ['inspect', 'read', 'search_content'],
      contentSummary: text.slice(0, 4_000),
      parsedContent: {
        title: parsed.title ?? null,
        kind: parsed.kind,
        mimeType: parsed.mimeType ?? input.mimeType,
        extension: parsed.extension ?? input.extension,
        text,
        sections: Array.isArray(parsed.sections)
          ? parsed.sections.slice(0, 50).map((section) => ({
              ...section,
              content: String(section.content ?? '').slice(0, 20_000),
            }))
          : [],
        tables: Array.isArray(parsed.tables)
          ? parsed.tables.slice(0, 10).map((table) => ({
              ...table,
              headers: Array.isArray(table.headers) ? table.headers.slice(0, 50) : [],
              rows: Array.isArray(table.rows) ? table.rows.slice(0, 200) : [],
              rawRows: Array.isArray(table.rawRows) ? table.rawRows.slice(0, 200) : [],
            }))
          : [],
        styleProfile: parsed.styleProfile ?? null,
        layoutAst: parsed.layoutAst ?? null,
        meta: parsedMeta,
      },
      metadata: {
        parsedAt: String(parsedMeta.parsedAt ?? new Date().toISOString()),
        textLength: fullText.length,
        cachedTextLength: text.length,
      },
    };
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
