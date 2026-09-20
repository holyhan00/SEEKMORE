                                                                 
import { Injectable } from '@nestjs/common';
import { LineCounter, isMap, parseDocument } from 'yaml';
import { SkillDomainError } from '../domain/skill.errors';
import type {
  ParsedSkillDocument,
  SkillDocumentFrontmatter,
  SkillDocumentLocations,
} from '../domain/skill-document.types';

@Injectable()
export class SkillFrontmatterParser {
  parse(markdown: string): ParsedSkillDocument {
    const rawMarkdown = String(markdown ?? '');
    const source = rawMarkdown.startsWith('\uFEFF')
      ? rawMarkdown.slice(1)
      : rawMarkdown;

    const opening = /^(---)[ \t]*(\r\n|\n|\r)/.exec(source);
    if (!opening) {
      throw new SkillDomainError(
        'SKILL_FRONTMATTER_REQUIRED',
        'SKILL.md must begin with YAML frontmatter.',
        { line: 1, column: 1 },
      );
    }

    const frontmatterStart = opening[0].length;
    const closing = this.findClosingDelimiter(source, frontmatterStart);
    if (!closing) {
      throw new SkillDomainError(
        'SKILL_FRONTMATTER_UNCLOSED',
        'SKILL.md YAML frontmatter is not closed.',
        { line: 1, column: 1 },
      );
    }

    const frontmatterRaw = source.slice(
      frontmatterStart,
      closing.start,
    );
    const bodyRaw = source.slice(closing.end);
    const lineCounter = new LineCounter();
    const document = parseDocument(frontmatterRaw, {
      lineCounter,
      prettyErrors: false,
      uniqueKeys: true,
      strict: true,
      schema: 'core',
    });

    if (document.errors.length > 0) {
      const error = document.errors[0];
      const linePos = error.linePos?.[0];
      throw new SkillDomainError(
        'SKILL_FRONTMATTER_YAML_INVALID',
        error.message,
        {
          line: linePos ? linePos.line + 1 : 2,
          column: linePos?.col ?? 1,
        },
      );
    }

    if (!isMap(document.contents)) {
      throw new SkillDomainError(
        'SKILL_FRONTMATTER_MAPPING_REQUIRED',
        'SKILL.md frontmatter must be a YAML mapping.',
        { line: 2, column: 1 },
      );
    }

    const parsed = document.toJS({
      mapAsMap: false,
      maxAliasCount: 50,
    }) as unknown;

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new SkillDomainError(
        'SKILL_FRONTMATTER_MAPPING_REQUIRED',
        'SKILL.md frontmatter must be a YAML mapping.',
        { line: 2, column: 1 },
      );
    }

    const frontmatter = parsed as Record<string, unknown>;
    const locations: SkillDocumentLocations = {
      frontmatterStartLine: 1,
      frontmatterEndLine: this.lineNumberAt(
        source,
        closing.start,
      ),
      bodyStartLine: this.lineNumberAt(source, closing.end),
      fields: {},
    };

    for (const item of document.contents.items) {
      const key = String(
        item.key?.toJSON?.() ?? item.key ?? '',
      );
      if (!key || !item.key?.range) continue;
      const position = lineCounter.linePos(
        item.key.range[0],
      );
      locations.fields[key] = {
        line: position.line + 1,
        column: position.col,
      };
    }

    return {
      rawMarkdown,
      frontmatterRaw,
      bodyRaw,
      body: bodyRaw,
      frontmatter,
      raw: frontmatter,
      manifest: this.standardProjection(frontmatter),
      locations,
    };
  }

  private standardProjection(
    value: Record<string, unknown>,
  ): SkillDocumentFrontmatter {
    const projection: SkillDocumentFrontmatter = {
      name:
        typeof value.name === 'string'
          ? value.name
          : '',
      description:
        typeof value.description === 'string'
          ? value.description
          : '',
    };

    if (typeof value.license === 'string') {
      projection.license = value.license;
    }

    if (typeof value.compatibility === 'string') {
      projection.compatibility = value.compatibility;
    }

    if (
      value.metadata &&
      typeof value.metadata === 'object' &&
      !Array.isArray(value.metadata)
    ) {
      const standardMetadata = Object.fromEntries(
        Object.entries(value.metadata).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string',
        ),
      );
      if (Object.keys(standardMetadata).length > 0) {
        projection.metadata = standardMetadata;
      }
    }

    if (typeof value['allowed-tools'] === 'string') {
      projection.allowedTools = value['allowed-tools'];
    }

    return projection;
  }

  private findClosingDelimiter(
    source: string,
    from: number,
  ): { start: number; end: number } | null {
    let cursor = from;
    while (cursor <= source.length) {
      const nextNewline = this.nextLineBreak(source, cursor);
      const lineEnd =
        nextNewline?.index ?? source.length;
      const line = source.slice(cursor, lineEnd);
      if (/^---[ \t]*$/.test(line)) {
        const end = nextNewline
          ? nextNewline.index + nextNewline.length
          : lineEnd;
        return { start: cursor, end };
      }
      if (!nextNewline) break;
      cursor =
        nextNewline.index + nextNewline.length;
    }
    return null;
  }

  private nextLineBreak(
    source: string,
    from: number,
  ): { index: number; length: number } | null {
    for (
      let index = from;
      index < source.length;
      index += 1
    ) {
      if (source[index] === '\n') {
        return { index, length: 1 };
      }
      if (source[index] === '\r') {
        return {
          index,
          length:
            source[index + 1] === '\n' ? 2 : 1,
        };
      }
    }
    return null;
  }

  private lineNumberAt(
    source: string,
    index: number,
  ): number {
    let line = 1;
    for (
      let cursor = 0;
      cursor < index;
      cursor += 1
    ) {
      if (source[cursor] === '\n') {
        line += 1;
      } else if (source[cursor] === '\r') {
        line += 1;
        if (source[cursor + 1] === '\n') {
          cursor += 1;
        }
      }
    }
    return line;
  }
}
