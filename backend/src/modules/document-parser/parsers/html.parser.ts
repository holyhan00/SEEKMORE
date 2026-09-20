                                                             

import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { ParseDocumentInput, ParsedDocument } from '../document.types';
import { DocumentParser } from './document-parser.interface';

@Injectable()
export class HtmlDocumentParser implements DocumentParser {
  readonly kind = 'html' as const;
  readonly version = '1.0.0';

  readonly support = {
    mimeTypes: ['text/html', 'application/xhtml+xml'],
    extensions: ['html', 'htm'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();

    return (
      this.support.extensions.includes(ext || '') ||
      this.support.mimeTypes.includes(input.mimeType || '')
    );
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    const html = input.buffer.toString('utf8').replace(/^\uFEFF/, '');

    const $ = cheerio.load(html);

    $('script, style, noscript').remove();

    const title = $('title').text().trim() || input.objectName;

    const text = $('body').text().replace(/\s+/g, ' ').trim();

    const sections: ParsedDocument['sections'] = [];

    let currentTitle: string | undefined;
    let currentLevel = 1;
    let currentContent: string[] = [];

    $('body')
      .children()
      .each((_, el) => {
        const tag = (el.tagName || '').toLowerCase();

        const node = $(el);

        const nodeText = node.text().trim();

        if (!nodeText) return;

        const headingMatch = /^h([1-6])$/.exec(tag);

        if (headingMatch) {
          if (currentContent.length) {
            sections.push({
              title: currentTitle,
              content: currentContent.join('\n').trim(),
              level: currentLevel,
              meta: {
                source: 'html',
              },
            });
          }

          currentTitle = nodeText;
          currentLevel = Number(headingMatch[1]);
          currentContent = [];

          return;
        }

        currentContent.push(nodeText);
      });

    if (currentContent.length) {
      sections.push({
        title: currentTitle,
        content: currentContent.join('\n').trim(),
        level: currentLevel,
        meta: {
          source: 'html',
        },
      });
    }

    return {
      text,
      title,
      kind: this.kind,
      mimeType: input.mimeType,
      extension: input.extension,
      sections,
      meta: {
        title,
        sectionCount: sections.length,
      },
    };
  }
}
