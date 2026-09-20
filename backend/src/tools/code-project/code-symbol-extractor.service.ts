import { Injectable } from '@nestjs/common';
import type { CodeProjectScanFile, CodeSymbolProfile } from './code-project.types';

@Injectable()
export class CodeSymbolExtractorService {
  extract(objects: CodeProjectScanFile[]): CodeSymbolProfile[] {
    const symbols: CodeSymbolProfile[] = [];
    for (const file of objects) {
      const lines = file.content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const symbol = this.extractLineSymbol({ filePath: file.path, line, lineNo: index + 1 });
        if (symbol) symbols.push(symbol);
      }
    }
    return symbols.slice(0, Number(process.env.CODE_PROJECT_MAX_SYMBOLS ?? 5000));
  }

  private extractLineSymbol(input: { filePath: string; line: string; lineNo: number }): CodeSymbolProfile | null {
    const line = input.line.trim();
    if (!line || line.startsWith('//') || line.startsWith('*')) return null;

    const patterns: Array<{ kind: CodeSymbolProfile['kind']; regex: RegExp }> = [
      { kind: 'class', regex: /\bexport\s+class\s+([A-Za-z_$][\w$]*)|\bclass\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'interface', regex: /\bexport\s+interface\s+([A-Za-z_$][\w$]*)|\binterface\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'type', regex: /\bexport\s+type\s+([A-Za-z_$][\w$]*)|\btype\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'enum', regex: /\bexport\s+enum\s+([A-Za-z_$][\w$]*)|\benum\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'function', regex: /\bexport\s+async\s+function\s+([A-Za-z_$][\w$]*)|\bexport\s+function\s+([A-Za-z_$][\w$]*)|\basync\s+function\s+([A-Za-z_$][\w$]*)|\bfunction\s+([A-Za-z_$][\w$]*)/ },
      { kind: 'const', regex: /\bexport\s+const\s+([A-Za-z_$][\w$]*)|\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?/ },
      { kind: 'method', regex: /^\s*(?:public|private|protected|async|static|readonly|override|final|\s)*\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/ },
    ];

    for (const item of patterns) {
      const match = line.match(item.regex);
      const name = match?.slice(1).find(Boolean);
      if (!name) continue;
      return {
        name,
        kind: this.semanticKind(name, input.filePath, item.kind),
        filePath: input.filePath,
        lineStart: input.lineNo,
        lineEnd: input.lineNo,
        signature: line.slice(0, 300),
        exported: /^export\b/.test(line),
      };
    }
    return null;
  }

  private semanticKind(name: string, filePath: string, fallback: CodeSymbolProfile['kind']): CodeSymbolProfile['kind'] {
    if (/controller/i.test(name) || /controller\.(ts|js)$/i.test(filePath)) return 'controller';
    if (/service/i.test(name) || /service\.(ts|js)$/i.test(filePath)) return 'service';
    if (/module/i.test(name) || /module\.(ts|js)$/i.test(filePath)) return 'module';
    if (/^use[A-Z]/.test(name)) return 'hook';
    if (/\.(tsx|jsx|vue)$/i.test(filePath) && /^[A-Z]/.test(name)) return 'component';
    return fallback;
  }
}
