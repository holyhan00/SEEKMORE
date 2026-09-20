                                                         

import { Injectable } from '@nestjs/common';
import { ParseDocumentInput, ParsedDocument } from '../document.types';
import { DocumentParser } from './document-parser.interface';

@Injectable()
export class MarkdownDocumentParser implements DocumentParser {
  readonly kind = 'markdown' as const;
  readonly version = '1.0.0';

  readonly support = {
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    extensions: ['md', 'markdown'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();

    return (
      this.support.extensions.includes(ext || '') ||
      this.support.mimeTypes.includes(input.mimeType || '')
    );
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    const text = input.buffer.toString('utf8').replace(/^\uFEFF/, '');

    const lines = text.split('\n');

    const sections: ParsedDocument['sections'] = [];

    let currentTitle: string | undefined;
    let currentLevel = 1;
    let currentContent: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();

      const heading = /^(#{1,6})\s+(.+)$/.exec(line);

      if (heading) {
        if (currentContent.length) {
          sections.push({
            title: currentTitle,
            content: currentContent.join('\n').trim(),
            level: currentLevel,
            meta: {
              source: 'markdown',
            },
          });
        }

        currentLevel = heading[1].length;
        currentTitle = heading[2].trim();
        currentContent = [];
        continue;
      }

      currentContent.push(rawLine);
    }

    if (currentContent.length) {
      sections.push({
        title: currentTitle,
        content: currentContent.join('\n').trim(),
        level: currentLevel,
        meta: {
          source: 'markdown',
        },
      });
    }

    return {
      text,
      title: input.objectName,
      kind: this.kind,
      mimeType: input.mimeType,
      extension: input.extension,
      sections,
      meta: {
        sectionCount: sections.length,
      },
    };
  }
}
