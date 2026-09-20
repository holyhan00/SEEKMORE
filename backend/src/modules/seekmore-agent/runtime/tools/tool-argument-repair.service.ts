import { Injectable } from '@nestjs/common';

@Injectable()
export class ToolArgumentRepairService {
  parse(raw: string | undefined, fallback: Record<string, unknown>): {
    arguments: Record<string, unknown>;
    repaired: boolean;
    error?: string;
  } {
    const source = String(raw ?? '').trim();
    if (!source) return { arguments: fallback ?? {}, repaired: false };

    const candidates = this.candidates(source);
    for (let index = 0; index < candidates.length; index += 1) {
      const parsed = this.parseCandidate(candidates[index]);
      if (parsed) {
        return {
          arguments: parsed,
          repaired: index > 0,
        };
      }
    }

    return {
      arguments: fallback ?? {},
      repaired: false,
      error: 'Tool arguments are not a valid JSON object',
    };
  }

  private parseCandidate(candidate: string): Record<string, unknown> | null {
    try {
      let parsed: unknown = JSON.parse(candidate);
                                                                                 
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private candidates(source: string): string[] {
    const stripped = source
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const extracted = extractObject(stripped);
    const smartQuotes = stripped
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    const pythonLiterals = replacePythonLiterals(smartQuotes);
    const quotedKeys = quoteBareKeys(pythonLiterals);
    const noTrailingCommas = quotedKeys.replace(/,\s*([}\]])/g, '$1');
    const balanced = balance(noTrailingCommas);

    return [...new Set([
      source,
      stripped,
      extracted,
      smartQuotes,
      pythonLiterals,
      quotedKeys,
      noTrailingCommas,
      balanced,
    ])].filter(Boolean);
  }
}

function extractObject(value: string): string {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
}

function quoteBareKeys(value: string): string {
  return value.replace(/([{,]\s*)([A-Za-z_$][\w$.-]*)(\s*:)/g, '$1"$2"$3');
}

function replacePythonLiterals(value: string): string {
  let output = '';
  let quoted = false;
  let escaped = false;
  let token = '';

  const flush = () => {
    if (!token) return;
    if (!quoted && token === 'True') output += 'true';
    else if (!quoted && token === 'False') output += 'false';
    else if (!quoted && token === 'None') output += 'null';
    else output += token;
    token = '';
  };

  for (const char of value) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      token += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      flush();
      quoted = !quoted;
      output += char;
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      token += char;
      continue;
    }
    flush();
    output += char;
  }
  flush();
  return output;
}

function balance(value: string): string {
  let braces = 0;
  let brackets = 0;
  let quoted = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === '{') braces += 1;
    if (char === '}') braces -= 1;
    if (char === '[') brackets += 1;
    if (char === ']') brackets -= 1;
  }

  return value
    + ']'.repeat(Math.max(0, brackets))
    + '}'.repeat(Math.max(0, braces));
}
