                                                             

import { Injectable } from '@nestjs/common';
import { ParseDocumentInput, ParsedDocument } from '../document.types';
import { DocumentParser } from './document-parser.interface';

@Injectable()
export class CodeDocumentParser implements DocumentParser {
  readonly kind = 'code' as const;
  readonly version = '1.0.0';

  readonly support = {
    mimeTypes: ['text/javascript', 'application/javascript', 'text/typescript', 'text/x-python', 'text/plain'],
    extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'vue', 'css', 'scss', 'sql', 'prisma', 'yaml', 'yml'],
  };

  canParse(input: ParseDocumentInput): boolean {
    const ext = input.extension?.toLowerCase();
    return this.support.extensions.includes(ext || '');
  }

  async parse(input: ParseDocumentInput): Promise<ParsedDocument> {
    const text = input.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/);
    return {
      text,
      title: input.objectName,
      kind: this.kind,
      mimeType: input.mimeType,
      extension: input.extension,
      sections: [
        {
          title: 'Code summary',
          content: this.summarize(lines),
          level: 1,
          meta: { lineCount: lines.length },
        },
      ],
      meta: {
        lineCount: lines.length,
        imports: lines.filter((line) => /^\s*(import|from|require\(|package\s+)/.test(line)).slice(0, 80),
        declarations: lines.filter((line) => /^\s*(export\s+)?(class|function|interface|type|const|let|var)\s+/.test(line)).slice(0, 120),
      },
    };
  }

  private summarize(lines: string[]): string {
    const meaningful = lines
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//') && !line.startsWith('*'))
      .slice(0, 120);
    return meaningful.join('\n');
  }
}
