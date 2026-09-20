                                                         
import { toSafeString } from './acgMarks';

                    
export function safeParseJSON<T = any>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

                                             
export function extractSingleJsonAfterMark<T>(rawInput: any, MARK: string): T | null {
  const raw = toSafeString(rawInput);
  if (!raw) return null;

  const idx = raw.indexOf(MARK);
  if (idx === -1) return null;
  const j = raw.indexOf('{', idx);
  if (j === -1) return null;

  let depth = 0, endPos = -1, inString = false, escape = false;
  for (let k = j; k < raw.length; k++) {
    const ch = raw[k];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { endPos = k + 1; break; }
      }
    }
  }
  if (endPos === -1) return null;
  return safeParseJSON<T>(raw.slice(j, endPos));
}